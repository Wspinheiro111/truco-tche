/**
 * Socket.io server for Truco Tchê multiplayer.
 * Server-authoritative: game state lives on the server.
 */
import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { randomInt } from "node:crypto";
import {
  createGameState, dealHand, playCard, callTruco, acceptTruco,
  refuseTruco, raiseTruco, callEnvido, acceptEnvido, refuseEnvido,
  callFlor, acceptFlor, refuseFlor, fold, getPlayerView,
  GameState, Player, TRUCO_POINTS, TURN_TIMEOUT_MS as ENGINE_TURN_TIMEOUT_MS,
} from "../shared/gameEngine";
import { areFriends, claimFriendGameInvite, createActiveOnlineGame, createFriendGameInvite, getActiveOnlineGameByRoom, getActiveOnlineGameForUser, getDb, updateActiveOnlineGame } from "./db";
import { onlineRooms, onlineMatches, onlineTournaments, onlineTournamentPlayers, users } from "../drizzle/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { sdk } from "./_core/sdk";
import { getSessionCookieFromHeader } from "./_core/cookies";
import { buildOneVsOneOpeningRound, OnlineTournamentMatch, roundCountForCapacity, validateOneVsOneCapacity } from "./onlineTournamentRules";
import { createChampionCertificate } from "./tournamentCertificate";

// Lazy DB helper
async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// ── Types ──
interface RoomData {
  code: string;
  hostSocket: string;
  guestSocket: string | null;
  hostUserId: number;
  guestUserId: number | null;
  hostName: string;
  guestName: string | null;
  mode: string;
  stakeTier: string;
  region: string;
  isPrivate: boolean;
  privateInviteeId: number | null;
  state: GameState | null;
  playerMap: { p1: string; p2: string }; // socket ids
  userMap: { p1: number; p2: number };   // user ids
  nameMap: { p1: string; p2: string };
  startTime: number;
  spectators: Set<string>;
  tournamentId: number | null;
  // Reconnection support
  disconnectedPlayers: Map<Player, { userId: number; userName: string; disconnectedAt: number; timer: ReturnType<typeof setTimeout> }>;
  // Waiting timeout (auto-close if no guest joins)
  waitingTimer: ReturnType<typeof setTimeout> | null;
  waitingStartedAt: number;
  // Turn timeout (auto-fold if player takes too long)
  turnTimer: ReturnType<typeof setTimeout> | null;
  turnTimerPlayer: Player | null;
  /** Versão do snapshot no banco para controlar concorrência entre instâncias. */
  snapshotVersion: number | null;
}

// ── In-memory state ──
const rooms = new Map<string, RoomData>();
const matchmakingQueue: { socketId: string; userId: number; userName: string; mode: string }[] = [];
const socketToRoom = new Map<string, string>(); // socketId -> roomCode
const socketToUser = new Map<string, { userId: number; userName: string }>(); // socketId -> user info
const userToRoom = new Map<number, string>(); // userId -> roomCode (for reconnection)
let socketIo: Server | null = null;

export type RulesTestFailureAlert = {
  executionId: number;
  passed: number;
  total: number;
  failedChecks: { title: string; group: string; detail?: string }[];
  createdAt: string;
};

/** Emite um aviso apenas para os administradores conectados nesta instância. */
export function emitRulesTestFailureToAdmins(alert: RulesTestFailureAlert): boolean {
  if (!socketIo) return false;
  socketIo.to("admins").emit("rules_test_failure", alert);
  return true;
}

// Atomic counter: tracks players currently in an active (playing) game.
// Updated in startGame (+2) and endOnlineGame (-2) to avoid the inaccurate rooms.size × 2 estimate.
let playersInGame = 0;

// Matchmaking lock: prevents race conditions when two sockets call find_match simultaneously.
// Node.js is single-threaded but async gaps between queue check and room creation can cause
// the same queued player to be matched twice. The lock serialises the critical section.
let matchmakingLocked = false;

export function getTotalOnlinePlayers(usersBySocket: Iterable<{ userId: number }>): number {
  return new Set(Array.from(usersBySocket, user => user.userId)).size;
}

export function isWaitingRoomExpired(createdAt: Date | string | number, now = Date.now()): boolean {
  const createdAtMs = new Date(createdAt).getTime();
  return Number.isFinite(createdAtMs) && now - createdAtMs >= ROOM_WAIT_TIMEOUT_MS;
}

export function canJoinPrivateRoom(isPrivate: boolean, privateInviteeId: number | null, userId: number): boolean {
  return !isPrivate || privateInviteeId === userId;
}

const RECONNECT_GRACE_MS = 30_000; // 30 seconds grace period
const ROOM_WAIT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes waiting for opponent
const TOURNAMENT_REGISTER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max in registering state
const TURN_TIMEOUT_MS = ENGINE_TURN_TIMEOUT_MS; // shared 30-second AFK limit

export type WaitingRoomSummary = {
  code: string;
  hostName: string;
  mode: string;
  stakeTier: string;
  region: string;
  spectators: number;
};

export type RoomFilters = {
  mode?: string;
  stakeTier?: string;
  region?: string;
};

const ROOM_MODES = new Set(["1v1", "desafio", "torneio"]);
const STAKE_TIERS = new Set(["amistoso", "baixo", "medio", "alto"]);
const ROOM_REGIONS = new Set(["BR", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "40"]);

function normalizeRoomValue(value: unknown, allowed: Set<string>, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  const matched = Array.from(allowed).find(item => item.toUpperCase() === normalized);
  return matched ?? fallback;
}

export function normalizeRoomPreferences(input: RoomFilters = {}) {
  return {
    mode: normalizeRoomValue(input.mode, ROOM_MODES, "1v1"),
    stakeTier: normalizeRoomValue(input.stakeTier, STAKE_TIERS, "amistoso"),
    region: normalizeRoomValue(input.region, ROOM_REGIONS, "40"),
  };
}

export function getWaitingRoomSummaries(
  roomCollection: Iterable<Pick<RoomData, "code" | "hostName" | "mode" | "stakeTier" | "region" | "state" | "guestSocket" | "spectators">>,
  filters: RoomFilters = {},
): WaitingRoomSummary[] {
  const normalizedFilters = normalizeRoomPreferences({
    mode: filters.mode === "all" ? undefined : filters.mode,
    stakeTier: filters.stakeTier === "all" ? undefined : filters.stakeTier,
    region: filters.region === "all" ? undefined : filters.region,
  });
  const modeFilter = filters.mode && filters.mode !== "all" ? normalizedFilters.mode : null;
  const stakeFilter = filters.stakeTier && filters.stakeTier !== "all" ? normalizedFilters.stakeTier : null;
  const regionFilter = filters.region && filters.region !== "all" ? normalizedFilters.region : null;
  return Array.from(roomCollection)
    .filter(room => room.state === null && !room.guestSocket)
    .filter(room => (!modeFilter || room.mode === modeFilter) && (!stakeFilter || room.stakeTier === stakeFilter) && (!regionFilter || room.region === regionFilter))
    .map(room => ({
      code: room.code,
      hostName: room.hostName,
      mode: room.mode,
      stakeTier: room.stakeTier,
      region: room.region,
      spectators: room.spectators.size,
    }));
}

// Map of tournamentId -> registration timeout timer
const tournamentRegisterTimers = new Map<number, ReturnType<typeof setTimeout>>();

// ── Room code generator ──
function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function getTurnDeadline(state: GameState): Date | null {
  if (["waiting", "between_hands", "game_over"].includes(state.phase)) return null;
  return new Date(state.turnStartedAt + state.turnTimeoutMs);
}

function roomFromSnapshot(snapshot: NonNullable<Awaited<ReturnType<typeof getActiveOnlineGameByRoom>>>): RoomData {
  const state = JSON.parse(snapshot.stateJson) as GameState;
  return {
    code: snapshot.roomCode,
    hostSocket: "",
    guestSocket: null,
    hostUserId: snapshot.player1Id,
    guestUserId: snapshot.player2Id,
    hostName: snapshot.player1Name,
    guestName: snapshot.player2Name,
    mode: "1v1",
    stakeTier: "amistoso",
    region: "BR",
    isPrivate: false,
    privateInviteeId: null,
    state,
    playerMap: { p1: "", p2: "" },
    userMap: { p1: snapshot.player1Id, p2: snapshot.player2Id },
    nameMap: { p1: snapshot.player1Name, p2: snapshot.player2Name },
    startTime: new Date(snapshot.createdAt).getTime(),
    spectators: new Set(),
    tournamentId: null,
    disconnectedPlayers: new Map(),
    waitingTimer: null,
    waitingStartedAt: new Date(snapshot.createdAt).getTime(),
    turnTimer: null,
    turnTimerPlayer: null,
    snapshotVersion: snapshot.version,
  };
}

async function persistRoomState(room: RoomData, eventId: string): Promise<boolean> {
  if (!room.state || room.snapshotVersion === null) return true;
  const reconnectAt = eventId === "reconnect:p1" || eventId === "reconnect:p2" ? new Date() : undefined;
  const persisted = await updateActiveOnlineGame(room.code, room.snapshotVersion, {
    stateJson: JSON.stringify(room.state),
    turnDeadline: getTurnDeadline(room.state),
    lastEventId: eventId,
    ...(eventId === "reconnect:p1" ? { player1ReconnectedAt: reconnectAt } : {}),
    ...(eventId === "reconnect:p2" ? { player2ReconnectedAt: reconnectAt } : {}),
    status: room.state.phase === "game_over" ? "finished" : "active",
  });
  if (persisted) {
    room.snapshotVersion += 1;
    return true;
  }
  const latest = await getActiveOnlineGameByRoom(room.code);
  if (latest?.status === "active") {
    room.state = JSON.parse(latest.stateJson) as GameState;
    room.snapshotVersion = latest.version;
  }
  return false;
}

// ── Initialize Socket.io ──
export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/api/socketio",
    transports: ["websocket", "polling"],
  });
  socketIo = io;
  console.log("[Socket.io] Multiplayer server initialized");

  // ── Startup cleanup: closes only abandoned waiting rooms ──
  // Partidas em andamento são recuperadas do snapshot persistido; nunca devem
  // ser invalidadas só porque esta instância não possui a sala no Map local.
  const STALE_WAITING_MS   = 10 * 60 * 1000; // 10 min without a guest

  async function cleanupStaleRooms() {
    try {
      const d = await db();
      const now = new Date();

      // 1. Close 'waiting' rooms with no active in-memory room that are older than STALE_WAITING_MS
      const staleWaiting = await d.select({ code: onlineRooms.code, updatedAt: onlineRooms.updatedAt })
        .from(onlineRooms)
        .where(eq(onlineRooms.status, 'waiting'));

      for (const row of staleWaiting) {
        const updatedMs = new Date(row.updatedAt).getTime();
        const ageMs = now.getTime() - updatedMs;
        // Em Autoscale, uma sala pode ter sido criada por outra instância; o Map
        // local não é critério de abandono. Somente a idade persistida decide.
        if (ageMs > STALE_WAITING_MS) {
          await d.update(onlineRooms)
            .set({ status: 'abandoned' })
            .where(eq(onlineRooms.code, row.code));
          console.log(`[Cleanup] Closed stale waiting room: ${row.code} (age: ${Math.round(ageMs / 60000)}min)`);
        }
      }

    } catch (e) {
      console.error('[Cleanup] Error during stale room cleanup:', e);
    }
  }

  // Execute apenas na inicialização: Cloud Run pode suspender instâncias e
  // timers recorrentes não são fonte de verdade para limpeza ou recuperação.
  void cleanupStaleRooms();

  // ── Helper: broadcast online stats ──
  function broadcastOnlineStats() {
    const totalOnline = getTotalOnlinePlayers(socketToUser.values());
    const inQueue = matchmakingQueue.length;
    // Use the atomic counter instead of rooms.size × 2, which was inaccurate:
    // it counted waiting rooms, rooms with only 1 player, and tournament BYE slots.
    io.emit("online_stats", { totalOnline, inQueue, inGame: playersInGame });
  }

  function broadcastWaitingRooms() {
    // O Map de salas pertence apenas a esta instância. Em Autoscale, transferir
    // esse conteúdo faria outro cliente substituir a lista global por um recorte
    // local. O evento é somente uma invalidação: cada cliente consulta o banco.
    io.emit("rooms_invalidated", { at: Date.now() });
  }

  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);
    // Send current stats to new connection
    setTimeout(() => {
      const totalOnline = getTotalOnlinePlayers(socketToUser.values());
      const inQueue = matchmakingQueue.length;
      socket.emit("online_stats", { totalOnline, inQueue, inGame: playersInGame });
    }, 500);
    // ── Auth: identify user (JWT-validated) ──
    // Security: instead of trusting the userId sent by the client (which could be
    // spoofed), we extract and verify the JWT from the Socket.IO handshake cookie.
    // Only if the JWT is valid do we accept the userId from the session payload.
    // For local-auth users (openId starts with 'local:'), the userId is cross-checked
    // against the DB to prevent impersonation.
    socket.on("auth", async (data: { userId: number; userName: string }, cb?: (res: { success: boolean; error?: string }) => void) => {
      try {
        const cookieHeader = socket.handshake.headers.cookie;
        const sessionCookie = getSessionCookieFromHeader(cookieHeader);

        if (sessionCookie) {
          // Verify JWT — this validates signature and expiry
          const session = await sdk.verifySession(sessionCookie);
          if (!session) {
            console.warn(`[Socket] Auth rejected for socket ${socket.id}: invalid JWT`);
            cb?.({ success: false, error: 'Invalid session' });
            return;
          }
          // JWT is valid — use the verified openId to look up the real userId in DB
          // This prevents a malicious client from passing a different userId
          const d = await getDb();
          const dbRows = d ? await d.select({ id: users.id, name: users.name, role: users.role })
            .from(users)
            .where(eq(users.openId, session.openId))
            .limit(1)
            .catch(() => []) : [];
          const dbUser = dbRows[0] ?? null;

          if (dbUser) {
            // Use the DB-verified userId and name — ignore what the client sent
            socketToUser.set(socket.id, { userId: dbUser.id, userName: dbUser.name || data.userName });
            if (dbUser.role === 'admin') socket.join('admins');
            broadcastOnlineStats();
            cb?.({ success: true });
            return;
          }
          // A valid JWT without a local row cannot safely be mapped to a numeric player.
          // Keep the socket unauthenticated until the HTTP session is synchronized.
          console.warn(`[Socket] Auth rejected: JWT user is not synchronized (openId: ${session.openId})`);
          cb?.({ success: false, error: 'User session is not synchronized' });
          return;
        }
        // No cookie is accepted only when explicitly running local development.
        if (process.env.NODE_ENV !== 'development') {
          console.warn(`[Socket] Auth rejected: missing JWT cookie for socket ${socket.id}`);
          cb?.({ success: false, error: 'Authentication required' });
          return;
        }
        console.warn(`[Socket] Development auth fallback for socket ${socket.id}, userId: ${data.userId}`);
        socketToUser.set(socket.id, { userId: data.userId, userName: data.userName });
        broadcastOnlineStats();
        cb?.({ success: true });
      } catch (err) {
        console.error(`[Socket] Auth error for socket ${socket.id}:`, err);
        cb?.({ success: false, error: 'Authentication failed' });
      }
    });

    socket.on("friendship_event", (data: { targetUserId?: number; kind?: "request" | "accepted" | "declined" }) => {
      const sender = socketToUser.get(socket.id);
      const targetUserId = Number(data?.targetUserId);
      if (!sender || !Number.isInteger(targetUserId) || targetUserId <= 0 || targetUserId === sender.userId) return;
      const kind = data.kind === "accepted" || data.kind === "declined" ? data.kind : "request";
      socketToUser.forEach((target, targetSocketId) => {
        if (target.userId === targetUserId) io.to(targetSocketId).emit("friendship_updated", { kind, senderId: sender.userId, senderName: sender.userName });
      });
    });

    // ── Create Room ──
    socket.on("create_room", async (data: { mode?: string; stakeTier?: string; region?: string; tournamentId?: number; privateInviteeId?: number }, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });
      const privateInviteeId = Number.isInteger(data?.privateInviteeId) && Number(data.privateInviteeId) > 0 ? Number(data.privateInviteeId) : null;
      if (privateInviteeId && !await areFriends(user.userId, privateInviteeId)) return cb?.({ error: "Convites privados exigem amizade confirmada" });
      const preferences = normalizeRoomPreferences(data);

      const code = genCode();
      const room: RoomData = {
        code,
        hostSocket: socket.id,
        guestSocket: null,
        hostUserId: user.userId,
        guestUserId: null,
        hostName: user.userName,
        guestName: null,
        mode: preferences.mode,
        stakeTier: preferences.stakeTier,
        region: preferences.region,
        isPrivate: Boolean(privateInviteeId),
        privateInviteeId,
        state: null,
        playerMap: { p1: socket.id, p2: "" },
        userMap: { p1: user.userId, p2: 0 },
        nameMap: { p1: user.userName, p2: "" },
        startTime: 0,
        spectators: new Set(),
        tournamentId: data.tournamentId || null,
        disconnectedPlayers: new Map(),
        waitingTimer: null,
        waitingStartedAt: Date.now(),
        turnTimer: null,
        turnTimerPlayer: null,
        snapshotVersion: null,
      };
      rooms.set(code, room);
      socketToRoom.set(socket.id, code);
      userToRoom.set(user.userId, code);
      socket.join(code);

      // Start waiting timeout — close room if no guest joins in 5 minutes
      room.waitingTimer = setTimeout(() => {
        const r = rooms.get(code);
        if (r && !r.guestSocket) {
          io.to(r.hostSocket).emit("room_timeout", { code });
          rooms.delete(code);
          socketToRoom.delete(r.hostSocket);
          userToRoom.delete(r.hostUserId);
          void db().then(d => d.update(onlineRooms).set({ status: "abandoned" }).where(eq(onlineRooms.code, code))).catch(() => {});
          broadcastWaitingRooms();
          console.log(`[Socket] Room ${code} timed out (no opponent joined)`);
        }
      }, ROOM_WAIT_TIMEOUT_MS);

      // Persistir antes de anunciar a sala. O banco é a fonte compartilhada entre
      // instâncias Autoscale; uma sala que não foi salva não pode ser descoberta.
      if (typeof user.userId === 'number') {
        try {
          await (await db()).insert(onlineRooms).values({
            code,
            hostId: user.userId,
            hostName: user.userName,
            mode: preferences.mode,
            stakeTier: preferences.stakeTier,
            region: preferences.region,
            isPrivate: Boolean(privateInviteeId),
            privateInviteeId,
            status: "waiting",
            tournamentId: data.tournamentId || null,
          });
        } catch (e: unknown) {
          console.error("[Socket] DB room insert error:", e);
          if (room.waitingTimer) clearTimeout(room.waitingTimer);
          rooms.delete(code);
          socketToRoom.delete(socket.id);
          userToRoom.delete(user.userId);
          socket.leave(code);
          cb?.({ error: "Não foi possível abrir a sala. Tente novamente." });
          return;
        }
      }

      if (privateInviteeId) {
        await createFriendGameInvite(user.userId, privateInviteeId, code);
        socketToUser.forEach((target, targetSocketId) => {
          if (target.userId === privateInviteeId) io.to(targetSocketId).emit("friend_game_invite", { roomCode: code, senderId: user.userId, senderName: user.userName, mode: preferences.mode, stakeTier: preferences.stakeTier, region: preferences.region });
        });
      }
      cb?.({ success: true, code, isPrivate: Boolean(privateInviteeId) });
      broadcastWaitingRooms();
      console.log(`[Socket] Room ${code} created by ${user.userName}`);
    });

    // ── Recover waiting room after a refresh or an Autoscale handoff ──
    socket.on("recover_waiting_room", async (data: { code?: string } | undefined, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });
      const roomQuery = and(
        eq(onlineRooms.hostId, user.userId),
        sql`${onlineRooms.status} IN ('waiting', 'playing')`,
        data?.code ? eq(onlineRooms.code, data.code.toUpperCase()) : undefined,
      );
      const [storedRoom] = await (await db()).select().from(onlineRooms)
        .where(roomQuery)
        .orderBy(desc(onlineRooms.createdAt))
        .limit(1);
      if (!storedRoom) return cb?.({ found: false });

      const isWaiting = storedRoom.status === "waiting";
      const elapsedMs = Date.now() - new Date(storedRoom.createdAt).getTime();
      const remainingMs = ROOM_WAIT_TIMEOUT_MS - elapsedMs;
      if (isWaiting && isWaitingRoomExpired(storedRoom.createdAt)) {
        await (await db()).update(onlineRooms).set({ status: "abandoned" }).where(eq(onlineRooms.code, storedRoom.code));
        return cb?.({ found: false });
      }

      let room = rooms.get(storedRoom.code);
      if (!room) {
        room = {
          code: storedRoom.code,
          hostSocket: socket.id,
          guestSocket: null,
          hostUserId: storedRoom.hostId,
          guestUserId: storedRoom.guestId ?? null,
          hostName: storedRoom.hostName,
          guestName: storedRoom.guestName ?? null,
          mode: storedRoom.mode,
          stakeTier: storedRoom.stakeTier,
          region: storedRoom.region,
          isPrivate: Boolean(storedRoom.isPrivate),
          privateInviteeId: storedRoom.privateInviteeId ?? null,
          state: null,
          playerMap: { p1: socket.id, p2: "" },
          userMap: { p1: storedRoom.hostId, p2: storedRoom.guestId ?? 0 },
          nameMap: { p1: storedRoom.hostName, p2: storedRoom.guestName ?? "" },
          startTime: 0,
          spectators: new Set(),
          tournamentId: storedRoom.tournamentId,
          disconnectedPlayers: new Map(),
          waitingTimer: null,
          waitingStartedAt: new Date(storedRoom.createdAt).getTime(),
          turnTimer: null,
          turnTimerPlayer: null,
          snapshotVersion: null,
        };
        rooms.set(room.code, room);
      }
      if (room.waitingTimer) clearTimeout(room.waitingTimer);
      room.hostSocket = socket.id;
      room.playerMap.p1 = socket.id;
      socketToRoom.set(socket.id, room.code);
      userToRoom.set(user.userId, room.code);
      socket.join(room.code);
      if (isWaiting) {
        room.waitingTimer = setTimeout(() => {
          const active = rooms.get(room!.code);
          if (!active || active.guestSocket) return;
          io.to(active.hostSocket).emit("room_timeout", { code: active.code });
          rooms.delete(active.code);
          socketToRoom.delete(active.hostSocket);
          userToRoom.delete(active.hostUserId);
          void db().then(d => d.update(onlineRooms).set({ status: "abandoned" }).where(eq(onlineRooms.code, active.code))).catch(() => {});
          broadcastWaitingRooms();
        }, remainingMs);
      }
      cb?.({ found: true, started: !isWaiting, code: room.code, mode: room.mode, stakeTier: room.stakeTier, region: room.region });
    });

    // ── Join Room ──
    socket.on("join_room", async (data: { code: string }, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });

      const code = data.code.toUpperCase();
      let room = rooms.get(code);
      if (!room) {
        const [storedRoom] = await (await db()).select().from(onlineRooms)
          .where(eq(onlineRooms.code, code))
          .limit(1);
        if (!storedRoom || storedRoom.status !== "waiting") return cb?.({ error: "Sala não encontrada" });
        room = {
          code: storedRoom.code,
          hostSocket: "",
          guestSocket: null,
          hostUserId: storedRoom.hostId,
          guestUserId: null,
          hostName: storedRoom.hostName,
          guestName: null,
          mode: storedRoom.mode,
          stakeTier: storedRoom.stakeTier,
          region: storedRoom.region,
          isPrivate: Boolean(storedRoom.isPrivate),
          privateInviteeId: storedRoom.privateInviteeId ?? null,
          state: null,
          playerMap: { p1: "", p2: "" },
          userMap: { p1: storedRoom.hostId, p2: 0 },
          nameMap: { p1: storedRoom.hostName, p2: "" },
          startTime: 0,
          spectators: new Set(),
          tournamentId: storedRoom.tournamentId,
          disconnectedPlayers: new Map(),
          waitingTimer: null,
          waitingStartedAt: new Date(storedRoom.createdAt).getTime(),
          turnTimer: null,
          turnTimerPlayer: null,
          snapshotVersion: null,
        };
        rooms.set(code, room);
      }
      if (room.guestSocket) return cb?.({ error: "Sala cheia" });
      if (room.hostUserId === user.userId) return cb?.({ error: "Não pode jogar contra si mesmo" });
      if (!canJoinPrivateRoom(room.isPrivate, room.privateInviteeId, user.userId)) return cb?.({ error: "Esta sala privada não foi convidada para você" });

      const reservation = await (await db()).update(onlineRooms)
        .set({ guestId: user.userId, guestName: user.userName, status: "playing" })
        .where(and(
          eq(onlineRooms.code, code),
          eq(onlineRooms.status, "waiting"),
          sql`${onlineRooms.guestId} IS NULL`,
        ));
      if (reservation[0].affectedRows !== 1) return cb?.({ error: "Sala cheia ou indisponível" });
      if (room.isPrivate) await claimFriendGameInvite(user.userId, code);

      // Cancel waiting timeout — opponent joined
      if (room.waitingTimer) { clearTimeout(room.waitingTimer); room.waitingTimer = null; }
      room.guestSocket = socket.id;
      room.guestUserId = user.userId;
      room.guestName = user.userName;
      room.playerMap.p2 = socket.id;
      room.userMap.p2 = user.userId;
      room.nameMap.p2 = user.userName;
      socketToRoom.set(socket.id, code);
      userToRoom.set(user.userId, code);  // ← Track user for reconnection
      socket.join(code);
      // Notify host
      io.to(room.hostSocket).emit("guest_joined", {
        guestName: user.userName,
        guestId: user.userId,
      });

      cb?.({ success: true, hostName: room.hostName, showChat: true });
      broadcastWaitingRooms();
      console.log(`[Socket] ${user.userName} joined room ${code}`);
      console.log(`[Socket] Room ${code} now has 2 players - starting game...`);

      // Auto-start game after short delay
      setTimeout(() => { void startGame(io, code); }, 800);
    });

    // ── Matchmaking ──
    socket.on("find_match", (data: { mode?: string }, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });

      // Guard against race conditions: although Node.js is single-threaded, async gaps
      // between the queue check and room creation could allow two concurrent find_match
      // calls to pair the same queued player with two different newcomers. The lock
      // serialises the critical section so only one pairing happens at a time.
      if (matchmakingLocked) {
        // Retry after a short delay so the caller is not silently dropped
        setTimeout(() => {
          socket.emit("queue_retry");
        }, 50);
        return cb?.({ queued: true, retrying: true });
      }
      matchmakingLocked = true;

      const mode = data.mode || "1v1";
      // Check if already in queue
      const existing = matchmakingQueue.findIndex(q => q.userId === user.userId);
      if (existing >= 0) matchmakingQueue.splice(existing, 1);

      // Try to find a match
      const matchIdx = matchmakingQueue.findIndex(q => q.mode === mode && q.userId !== user.userId);
      if (matchIdx >= 0) {
        const opponent = matchmakingQueue.splice(matchIdx, 1)[0];
        matchmakingLocked = false; // release lock before async work
        // Create room and put both in
        const code = genCode();
        const room: RoomData = {
          code,
          hostSocket: opponent.socketId,
          guestSocket: socket.id,
          hostUserId: opponent.userId,
          guestUserId: user.userId,
          hostName: opponent.userName,
          guestName: user.userName,
          mode,
          stakeTier: "amistoso",
          region: "BR",
          isPrivate: false,
          privateInviteeId: null,
          state: null,
          playerMap: { p1: opponent.socketId, p2: socket.id },
          userMap: { p1: opponent.userId, p2: user.userId },
          nameMap: { p1: opponent.userName, p2: user.userName },
          startTime: 0,
          spectators: new Set(),
          tournamentId: null,
          disconnectedPlayers: new Map(),
          waitingTimer: null,
          waitingStartedAt: Date.now(),
          turnTimer: null,
          turnTimerPlayer: null,
          snapshotVersion: null,
        };
        rooms.set(code, room);
        socketToRoom.set(opponent.socketId, code);
        socketToRoom.set(socket.id, code);
        userToRoom.set(opponent.userId, code);  // ← Track opponent for reconnection
        userToRoom.set(user.userId, code);      // ← Track user for reconnection

        const opponentSocket = io.sockets.sockets.get(opponent.socketId);
        opponentSocket?.join(code);
        socket.join(code);

        // Persist
        db().then(d => d.insert(onlineRooms).values({
          code,
          hostId: opponent.userId,
          hostName: opponent.userName,
          guestId: user.userId,
          guestName: user.userName,
          mode,
          stakeTier: "amistoso",
          region: "BR",
          status: "playing",
        })).catch(e => console.error("[Socket] DB error:", e));

        io.to(opponent.socketId).emit("match_found", {
          code, opponentName: user.userName, role: "host",
        });
        socket.emit("match_found", {
          code, opponentName: opponent.userName, role: "guest",
        });

        cb?.({ matched: true, code });
        console.log(`[Socket] Match found: ${opponent.userName} vs ${user.userName} in ${code}`);

        setTimeout(() => startGame(io, code), 800);
      } else {
        // Add to queue
        matchmakingQueue.push({ socketId: socket.id, userId: user.userId, userName: user.userName, mode });
        matchmakingLocked = false; // release lock
        cb?.({ queued: true });
        socket.emit("queue_update", { position: matchmakingQueue.filter(q => q.mode === mode).length });
        console.log(`[Socket] ${user.userName} queued for ${mode}`);
        broadcastOnlineStats();
      }
    });

    socket.on("cancel_matchmaking", () => {
      const user = socketToUser.get(socket.id);
      if (!user) return;
      const idx = matchmakingQueue.findIndex(q => q.userId === user.userId);
      if (idx >= 0) matchmakingQueue.splice(idx, 1);
      broadcastOnlineStats();
    });

    // ── Cancel Waiting Room ──
    socket.on("cancel_room", (dataOrCallback?: unknown | ((res: { ok: boolean }) => void), callback?: (res: { ok: boolean }) => void) => {
      const cb = typeof dataOrCallback === "function" ? dataOrCallback : callback;
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ ok: false });
      const roomCode = socketToRoom.get(socket.id);
      if (!roomCode) return cb?.({ ok: false });
      const room = rooms.get(roomCode);
      // Only allow cancellation if no game started yet (waiting state)
      if (!room || room.state) return cb?.({ ok: false });
      // Only the host can cancel a waiting room
      if (room.hostSocket !== socket.id) return cb?.({ ok: false });
      if (room.waitingTimer) { clearTimeout(room.waitingTimer); room.waitingTimer = null; }
      rooms.delete(roomCode);
      socketToRoom.delete(socket.id);
      userToRoom.delete(user.userId);
      socket.leave(roomCode);
      db().then(d => d.update(onlineRooms)
        .set({ status: 'abandoned' })
        .where(eq(onlineRooms.code, roomCode)))
        .catch(() => {});
      console.log(`[Socket] Room ${roomCode} cancelled by host ${user.userName}`);
      broadcastWaitingRooms();
      cb?.({ ok: true });
    });

    // ── Game Actions ──
    socket.on("play_card", async (data: { cardId: string }, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });

      try {
        const result = playCard(room.state, player, data.cardId);
        room.state = result.state;

        if (!await persistAndEmitGameState(io, room, `play_card:${data.cardId}`)) {
          return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        }

        if (result.roundResult) {
          io.to(room.code).emit("round_result", {
            result: result.roundResult,
            roundWins: room.state.roundWins,
            cards: result.completedTrick || [],
          });
        }
        if (result.handWinner) {
          io.to(room.code).emit("hand_winner", {
            winner: result.handWinner,
            winnerName: room.nameMap[result.handWinner],
            points: TRUCO_POINTS[room.state.trucoLevel] || 1,
            score: room.state.score,
          });

          if (result.gameWinner) {
            endOnlineGame(io, room, result.gameWinner);
          } else {
            setTimeout(() => { void dealNextHand(io, room, "next_hand:play_card"); }, 1500);
          }
        }
        cb?.({ ok: true });
      } catch (e: any) {
        cb?.({ error: e.message });
      }
    });

    socket.on("call_truco", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        room.state = callTruco(room.state, player);
        if (!await persistAndEmitGameState(io, room, "call_truco")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        const other: Player = player === "p1" ? "p2" : "p1";
        io.to(room.playerMap[other]).emit("truco_called", {
          level: room.state.trucoLevel,
          callerName: room.nameMap[player],
        });
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("accept_truco", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        room.state = acceptTruco(room.state, player);
        if (!await persistAndEmitGameState(io, room, "accept_truco")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        io.to(room.code).emit("truco_accepted", { level: room.state.trucoLevel });
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("refuse_truco", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        const result = refuseTruco(room.state, player);
        room.state = result.state;
        if (!await persistAndEmitGameState(io, room, "refuse_truco")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        io.to(room.code).emit("truco_refused", {
          winnerName: room.nameMap[result.handWinner],
        });
        if (result.gameWinner) {
          endOnlineGame(io, room, result.gameWinner);
        } else {
          setTimeout(() => { void dealNextHand(io, room, "next_hand:refuse_truco"); }, 1500);
        }
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("raise_truco", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        room.state = raiseTruco(room.state, player);
        if (!await persistAndEmitGameState(io, room, "raise_truco")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        const other: Player = player === "p1" ? "p2" : "p1";
        io.to(room.playerMap[other]).emit("truco_called", {
          level: room.state.trucoLevel,
          callerName: room.nameMap[player],
        });
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("call_envido", async (data: { action: string }, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        room.state = callEnvido(room.state, player, data.action);
        if (!await persistAndEmitGameState(io, room, `call_envido:${data.action}`)) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        const other: Player = player === "p1" ? "p2" : "p1";
        io.to(room.playerMap[other]).emit("envido_called", {
          action: data.action, bet: room.state.envidoBet,
          callerName: room.nameMap[player],
        });
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("accept_envido", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        const result = acceptEnvido(room.state, player);
        room.state = result.state;
        if (!await persistAndEmitGameState(io, room, "accept_envido")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        io.to(room.code).emit("envido_resolved", {
          accepted: true,
          winnerName: room.nameMap[result.envidoWinner],
          points: result.points,
          envidoPoints: room.state.envidoPoints,
        });
        if (result.gameWinner) endOnlineGame(io, room, result.gameWinner);
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("refuse_envido", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        const result = refuseEnvido(room.state, player);
        room.state = result.state;
        if (!await persistAndEmitGameState(io, room, "refuse_envido")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        io.to(room.code).emit("envido_resolved", {
          accepted: false, points: result.points,
        });
        if (result.gameWinner) endOnlineGame(io, room, result.gameWinner);
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("call_flor", async (data: { action: string }, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        room.state = callFlor(room.state, player, data.action);
        if (!await persistAndEmitGameState(io, room, `call_flor:${data.action}`)) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        const other: Player = player === "p1" ? "p2" : "p1";
        io.to(room.playerMap[other]).emit("flor_called", {
          action: data.action, bet: room.state.florBet,
        });
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("accept_flor", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        const result = acceptFlor(room.state, player);
        room.state = result.state;
        if (!await persistAndEmitGameState(io, room, "accept_flor")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        io.to(room.code).emit("flor_resolved", {
          accepted: true,
          winnerName: room.nameMap[result.florWinner],
          points: result.points,
        });
        if (result.gameWinner) endOnlineGame(io, room, result.gameWinner);
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("refuse_flor", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        const result = refuseFlor(room.state, player);
        room.state = result.state;
        if (!await persistAndEmitGameState(io, room, "refuse_flor")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        io.to(room.code).emit("flor_resolved", { accepted: false, points: result.points });
        if (result.gameWinner) endOnlineGame(io, room, result.gameWinner);
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("fold_hand", async (_data, cb) => {
      const room = getRoomForSocket(socket.id);
      if (!room || !room.state) return cb?.({ error: "No game" });
      const player = getPlayerRole(room, socket.id);
      if (!player) return cb?.({ error: "Not in game" });
      try {
        const result = fold(room.state, player);
        room.state = result.state;
        if (!await persistAndEmitGameState(io, room, "fold_hand")) return cb?.({ error: "Estado atualizado por outra instância. Tente novamente." });
        io.to(room.code).emit("player_folded", {
          folderName: room.nameMap[player],
          winnerName: room.nameMap[result.handWinner],
        });
        if (result.gameWinner) {
          endOnlineGame(io, room, result.gameWinner);
        } else {
          setTimeout(() => { void dealNextHand(io, room, "next_hand:fold_hand"); }, 1500);
        }
        cb?.({ ok: true });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    // ── Chat ──
    socket.on("chat_msg", (data: { msg: string }) => {
      const room = getRoomForSocket(socket.id);
      if (!room) return;
      const user = socketToUser.get(socket.id);
      socket.to(room.code).emit("chat_msg", { name: user?.userName || "?", msg: data.msg });
    });
    // ── Quick Chat (frases gaúchas pré-definidas) ──
    socket.on("quick_chat", (data: { phraseId: number }) => {
      const room = getRoomForSocket(socket.id);
      if (!room) return;
      const user = socketToUser.get(socket.id);
      // Relay para o adversário e espectadores
      io.to(room.code).emit("quick_chat", {
        name: user?.userName || "?",
        socketId: socket.id,
        phraseId: data.phraseId,
      });
    });

    // ── Spectate ──
    socket.on("spectate", (data: { code: string }, cb) => {
      const room = rooms.get(data.code?.toUpperCase());
      if (!room) return cb?.({ error: "Sala não encontrada" });
      room.spectators.add(socket.id);
      socket.join(room.code);
      if (room.state) {
        socket.emit("spectator_state", {
          score: room.state.score,
          roundWins: room.state.roundWins,
          phase: room.state.phase,
          table: room.state.table,
          names: room.nameMap,
        });
      }
      cb?.({ ok: true });
    });

    // ── List active rooms ──
    socket.on("list_rooms", async (filters: RoomFilters = {}, cb) => {
      const requester = socketToUser.get(socket.id);
      if (!requester) return cb?.({ rooms: [], error: "Not authenticated" });
      try {
        const normalized = normalizeRoomPreferences({
          mode: filters.mode === "all" ? undefined : filters.mode,
          stakeTier: filters.stakeTier === "all" ? undefined : filters.stakeTier,
          region: filters.region === "all" ? undefined : filters.region,
        });
        const clauses = [eq(onlineRooms.status, "waiting"), sql`(${onlineRooms.isPrivate} = false OR ${onlineRooms.privateInviteeId} = ${requester.userId})`];
        if (filters.mode && filters.mode !== "all") clauses.push(eq(onlineRooms.mode, normalized.mode));
        if (filters.stakeTier && filters.stakeTier !== "all") clauses.push(eq(onlineRooms.stakeTier, normalized.stakeTier));
        if (filters.region && filters.region !== "all") clauses.push(eq(onlineRooms.region, normalized.region));
        const storedRooms = await (await db()).select({
          code: onlineRooms.code,
          hostName: onlineRooms.hostName,
          mode: onlineRooms.mode,
          stakeTier: onlineRooms.stakeTier,
          region: onlineRooms.region,
          isPrivate: onlineRooms.isPrivate,
          createdAt: onlineRooms.createdAt,
        }).from(onlineRooms).where(and(...clauses));
        const expiredRooms = storedRooms.filter(room => isWaitingRoomExpired(room.createdAt));
        if (expiredRooms.length > 0) {
          const database = await db();
          await Promise.all(expiredRooms.map(room => database.update(onlineRooms)
            .set({ status: "abandoned" })
            .where(eq(onlineRooms.code, room.code))));
        }
        cb?.({ rooms: storedRooms
          .filter(room => !isWaitingRoomExpired(room.createdAt))
          .map(({ createdAt: _createdAt, ...room }) => ({ ...room, spectators: 0 })) });
      } catch (error) {
        console.error("[Socket] list_rooms failed:", error);
        cb?.({ rooms: [], error: "Não foi possível listar salas" });
      }
    });
    // ── List live rooms (partidas em andamento para espectadores) ──
    socket.on("list_live_rooms", (_data, cb) => {
      const liveRooms = Array.from(rooms.values())
        .filter(r => r.state !== null && r.guestSocket) // partidas em andamento
        .map(r => ({
          code: r.code,
          hostName: r.hostName,
          guestName: r.guestName || '?',
          mode: r.mode,
          spectators: r.spectators.size,
          score: r.state ? { p1: r.state.score.p1, p2: r.state.score.p2 } : null,
        }));
      cb?.({ rooms: liveRooms });
    });

    // ── Online Tournament: create ──
    socket.on("create_tournament", async (data: { name: string; maxPlayers: number; prize?: string; scheduledStartAt?: string }, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });

      const maxP = Number(data.maxPlayers);
      const capacityError = validateOneVsOneCapacity(maxP);
      if (capacityError) return cb?.({ error: capacityError });
      const totalRounds = roundCountForCapacity(maxP);
      const scheduledStartAt = data.scheduledStartAt ? new Date(data.scheduledStartAt) : null;
      if (scheduledStartAt && Number.isNaN(scheduledStartAt.getTime())) {
        return cb?.({ error: "Horário de referência inválido" });
      }

      try {
        const [result] = await (await db()).insert(onlineTournaments).values({
          creatorId: user.userId,
          name: data.name || "Torneio Online",
          maxPlayers: maxP,
          totalRounds,
          prize: data.prize || null,
          scheduledStartAt,
          status: "registering",
        }).$returningId();

        // Creator auto-joins
        await (await db()).insert(onlineTournamentPlayers).values({
          tournamentId: result.id,
          userId: user.userId,
          userName: user.userName,
          seed: 1,
        });

        socket.join(`tournament_${result.id}`);
        cb?.({ tournamentId: result.id, maxPlayers: maxP, format: "1v1", scheduledStartAt });
        io.emit("tournament_created", {
          id: result.id, name: data.name, maxPlayers: maxP, format: "1v1",
          creatorName: user.userName, currentPlayers: 1, prize: data.prize || null, scheduledStartAt,
        });

        // Registration timeout: cancel tournament if it never fills up
        const regTimer = setTimeout(async () => {
          try {
            const d3 = await db();
            const [t] = await d3.select().from(onlineTournaments).where(eq(onlineTournaments.id, result.id));
            if (t && t.status === "registering") {
              await d3.update(onlineTournaments)
                .set({ status: "cancelled" })
                .where(eq(onlineTournaments.id, result.id));
              io.to(`tournament_${result.id}`).emit("tournament_cancelled", {
                tournamentId: result.id,
                reason: "Tempo de inscrição esgotado (30 minutos)",
              });
              console.log(`[Tournament] Tournament ${result.id} cancelled due to registration timeout`);
            }
          } catch (err) {
            console.error(`[Tournament] Error cancelling timed-out tournament ${result.id}:`, err);
          } finally {
            tournamentRegisterTimers.delete(result.id);
          }
        }, TOURNAMENT_REGISTER_TIMEOUT_MS);
        tournamentRegisterTimers.set(result.id, regTimer);

      } catch (e: any) { cb?.({ error: e.message }); }
    });

    // ── Online Tournament: join ──
    socket.on("join_tournament", async (data: { tournamentId: number }, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });

      try {
        const d = await db();
        const [tournament] = await d.select().from(onlineTournaments)
          .where(eq(onlineTournaments.id, data.tournamentId));
        if (!tournament) return cb?.({ error: "Torneio não encontrado" });
        if (tournament.status !== "registering") return cb?.({ error: "Torneio já iniciado" });

        const players = await d.select().from(onlineTournamentPlayers)
          .where(eq(onlineTournamentPlayers.tournamentId, data.tournamentId));

        if (players.length >= tournament.maxPlayers) return cb?.({ error: "Torneio lotado" });
        if (players.some(p => p.userId === user.userId)) return cb?.({ error: "Já inscrito" });

        await d.insert(onlineTournamentPlayers).values({
          tournamentId: data.tournamentId,
          userId: user.userId,
          userName: user.userName,
          seed: players.length + 1,
        });

        socket.join(`tournament_${data.tournamentId}`);
        const updatedPlayers = [...players.map((p: { userId: number; userName: string; seed: number }) => p), { userId: user.userId, userName: user.userName, seed: players.length + 1 }];

        io.to(`tournament_${data.tournamentId}`).emit("tournament_player_joined", {
          tournamentId: data.tournamentId,
          playerName: user.userName,
          currentPlayers: updatedPlayers.length,
          maxPlayers: tournament.maxPlayers,
        });

        // Quando a chave completa, o organizador confirma manualmente o sorteio.
        if (updatedPlayers.length >= tournament.maxPlayers) {
          io.to(`tournament_${data.tournamentId}`).emit("tournament_ready_to_start", {
            tournamentId: data.tournamentId,
            creatorId: tournament.creatorId,
            currentPlayers: updatedPlayers.length,
          });
        }

        cb?.({ ok: true, currentPlayers: updatedPlayers.length });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    socket.on("start_tournament", async (data: { tournamentId: number }, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });
      try {
        const d = await db();
        const [tournament] = await d.select().from(onlineTournaments)
          .where(eq(onlineTournaments.id, data.tournamentId));
        if (!tournament) return cb?.({ error: "Torneio não encontrado" });
        if (tournament.creatorId !== user.userId) return cb?.({ error: "Somente o organizador pode iniciar a chave" });
        if (tournament.status !== "registering") return cb?.({ error: "Torneio já foi iniciado" });
        const players = await d.select({ id: onlineTournamentPlayers.id }).from(onlineTournamentPlayers)
          .where(eq(onlineTournamentPlayers.tournamentId, data.tournamentId));
        if (players.length !== tournament.maxPlayers) {
          return cb?.({ error: `Aguardando ${tournament.maxPlayers - players.length} inscrição(ões) para completar a chave` });
        }
        const regTimer = tournamentRegisterTimers.get(data.tournamentId);
        if (regTimer) {
          clearTimeout(regTimer);
          tournamentRegisterTimers.delete(data.tournamentId);
        }
        await startOnlineTournament(io, data.tournamentId);
        cb?.({ ok: true });
      } catch (error: any) {
        cb?.({ error: error?.message || "Não foi possível iniciar o torneio" });
      }
    });

    // ── Tournament: recover a ready private match from persistent storage ──
    socket.on("get_tournament_match", async (_data, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });
      try {
        const [matchRoom] = await (await db()).select().from(onlineRooms)
          .where(and(
            sql`${onlineRooms.status} IN ('waiting', 'playing')`,
            sql`${onlineRooms.tournamentId} IS NOT NULL`,
            or(eq(onlineRooms.hostId, user.userId), eq(onlineRooms.privateInviteeId, user.userId)),
          ))
          .orderBy(desc(onlineRooms.createdAt))
          .limit(1);
        if (!matchRoom) return cb?.({ found: false });
        cb?.({
          found: true,
          tournamentId: matchRoom.tournamentId,
          roomCode: matchRoom.code,
          status: matchRoom.status,
          opponentName: matchRoom.hostId === user.userId ? matchRoom.guestName : matchRoom.hostName,
          role: matchRoom.hostId === user.userId ? "host" : "guest",
        });
      } catch (error) {
        console.error("[Socket] get_tournament_match failed:", error);
        cb?.({ error: "Não foi possível recuperar o confronto do torneio" });
      }
    });

    socket.on("get_tournament_certificate", async (data: { tournamentId?: number }, cb) => {
      const user = socketToUser.get(socket.id);
      const tournamentId = Number(data?.tournamentId);
      if (!user) return cb?.({ error: "Not authenticated" });
      if (!Number.isInteger(tournamentId) || tournamentId <= 0) return cb?.({ error: "Torneio inválido" });
      try {
        const [tournament] = await (await db()).select().from(onlineTournaments)
          .where(eq(onlineTournaments.id, tournamentId));
        if (!tournament || tournament.status !== "completed" || !tournament.championCertificateUrl) {
          return cb?.({ error: "Certificado indisponível" });
        }
        const bracket = tournament.bracketData ? JSON.parse(tournament.bracketData) as { rounds?: OnlineTournamentMatch[][] } : null;
        const finalMatch = bracket?.rounds?.at(-1)?.[0];
        if (!finalMatch?.winnerId || finalMatch.winnerId !== user.userId) {
          return cb?.({ error: "Somente o campeão pode acessar este certificado" });
        }
        cb?.({ certificateUrl: tournament.championCertificateUrl, tournamentName: tournament.name });
      } catch (error) {
        console.error("[Socket] get_tournament_certificate failed:", error);
        cb?.({ error: "Não foi possível recuperar o certificado" });
      }
    });

    // ── List tournaments ──
    socket.on("list_tournaments", async (_data, cb) => {
      try {
        const d2 = await db();
        const tournaments = await d2.select().from(onlineTournaments)
          .where(sql`${onlineTournaments.status} IN ('registering', 'active')`)
          .orderBy(onlineTournaments.createdAt);

        const result = [];
        for (const t of tournaments) {
          const players = await d2.select().from(onlineTournamentPlayers)
            .where(eq(onlineTournamentPlayers.tournamentId, t.id));
          result.push({
            ...t,
            currentPlayers: players.length,
            players: players.map((p: { userName: string; seed: number; eliminated: boolean }) => ({ userName: p.userName, seed: p.seed, eliminated: p.eliminated })),
          });
        }
        cb?.({ tournaments: result });
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    // ── Leave Tournament (pre-start desistance) ──
    socket.on("leave_tournament", async (data: { tournamentId: number }, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Not authenticated" });

      try {
        const d4 = await db();
        const [tournament] = await d4.select().from(onlineTournaments)
          .where(eq(onlineTournaments.id, data.tournamentId));
        if (!tournament) return cb?.({ error: "Torneio não encontrado" });
        if (tournament.status !== "registering") return cb?.({ error: "Torneio já iniciado, não é possível sair" });

        // Remove player from tournament
        await d4.delete(onlineTournamentPlayers)
          .where(and(
            eq(onlineTournamentPlayers.tournamentId, data.tournamentId),
            eq(onlineTournamentPlayers.userId, user.userId)
          ));

        socket.leave(`tournament_${data.tournamentId}`);

        // Get updated player list
        const remaining = await d4.select().from(onlineTournamentPlayers)
          .where(eq(onlineTournamentPlayers.tournamentId, data.tournamentId));

        io.to(`tournament_${data.tournamentId}`).emit("tournament_player_left", {
          tournamentId: data.tournamentId,
          playerName: user.userName,
          currentPlayers: remaining.length,
          maxPlayers: tournament.maxPlayers,
        });

        cb?.({ ok: true });
        console.log(`[Tournament] ${user.userName} left tournament ${data.tournamentId} (${remaining.length}/${tournament.maxPlayers})`);
      } catch (e: any) { cb?.({ error: e.message }); }
    });

    // ── Reconnect: rejoin active game ──
    socket.on("reconnect_game", async (_data, cb) => {
      const authenticatedUser = socketToUser.get(socket.id);
      if (!authenticatedUser) return cb?.({ error: "Authentication required" });
      const { userId, userName } = authenticatedUser;

      let roomCode = userToRoom.get(userId);
      let room = roomCode ? rooms.get(roomCode) : undefined;
      let restoredFromSnapshot = false;

      // Em Autoscale, a nova conexão pode chegar a outra instância. Nesse caso,
      // a fonte de verdade é o snapshot ativo persistido, não o Map local.
      if (!room || !room.state) {
        const snapshot = await getActiveOnlineGameForUser(userId);
        if (!snapshot || snapshot.status !== "active") return cb?.({ error: "No active game found" });
        roomCode = snapshot.roomCode;
        const alreadyHydrated = rooms.get(roomCode);
        if (alreadyHydrated) {
          room = alreadyHydrated;
          room.state = JSON.parse(snapshot.stateJson) as GameState;
          room.snapshotVersion = snapshot.version;
          restoredFromSnapshot = true;
        } else {
          room = roomFromSnapshot(snapshot);
          rooms.set(roomCode, room);
          restoredFromSnapshot = true;
        }
      }

      // Validation 3: check game state is still active
      if (!room.state || room.state.phase === "game_over") {
        userToRoom.delete(userId);
        return cb?.({ error: "Game no longer active" });
      }

      // Validation 4: check userId actually belongs to this room
      const role: Player | null =
        room.userMap.p1 === userId ? "p1" :
        room.userMap.p2 === userId ? "p2" : null;
      if (!role) return cb?.({ error: "Not a player in this game" });

      // Validation 5: check the grace period timer is still active
      // If the player is in disconnectedPlayers, the timer hasn’t fired yet — OK.
      // If the player is NOT in disconnectedPlayers and their socket is already
      // mapped to this room, they are still connected — also OK (e.g. page refresh).
      // If neither condition holds, the walkover already happened.
      const pending = room.disconnectedPlayers.get(role);
      const currentSocketForRole = room.playerMap[role];
      const isStillConnected = currentSocketForRole && io.sockets.sockets.has(currentSocketForRole);

      if (!pending && !isStillConnected && !restoredFromSnapshot) {
        // Walkover timer already fired and the player was removed
        userToRoom.delete(userId);
        return cb?.({ error: "Reconnection grace period expired (W.O.)" });
      }

      // Cancel pending walkover timer if it exists
      if (pending) {
        clearTimeout(pending.timer);
        room.disconnectedPlayers.delete(role);
      }

      // Update socket mapping
      const resolvedRoomCode = roomCode ?? room.code;
      const oldSocket = room.playerMap[role];
      socketToRoom.delete(oldSocket);
      room.playerMap[role] = socket.id;
      if (role === "p1") room.hostSocket = socket.id;
      else room.guestSocket = socket.id;
      socketToRoom.set(socket.id, resolvedRoomCode);
      socketToUser.set(socket.id, { userId, userName });
      userToRoom.set(userId, resolvedRoomCode);
      socket.join(resolvedRoomCode);

      // Registra a reconexão na fonte de verdade. Uma instância que ainda
      // mantém o timer de abandono conseguirá identificar essa retomada.
      if (!await persistRoomState(room, `reconnect:${role}`)) {
        console.warn(`[Socket] Could not persist reconnection marker for ${resolvedRoomCode}`);
      }

      // Notify opponent
      const opponentRole: Player = role === "p1" ? "p2" : "p1";
      io.to(room.playerMap[opponentRole]).emit("opponent_reconnected", {
        name: userName,
      });

      // Re-send the current private game state to the reconnected player.
      // The opponent's cards remain hidden by getPlayerView().
      const view = getPlayerView(room.state, role);
      const turnTimeLeftMs = Math.max(
        0,
        (room.state.turnStartedAt + TURN_TIMEOUT_MS) - Date.now(),
      );
      socket.emit("game_state", {
        ...view,
        currentPlayer: view.turn,
        myRole: role,
        myName: room.nameMap[role],
        opponentName: room.nameMap[opponentRole],
        roomCode: resolvedRoomCode,
        turnTimeoutMs: TURN_TIMEOUT_MS,
        turnTimeLeftMs,
        reconnected: true,
      });
      startTurnTimer(io, room);

      console.log(`[Socket] ${userName} reconnected to room ${roomCode} as ${role}`);
      cb?.({ success: true, roomCode: resolvedRoomCode, role });
    });

    // ── Authoritative sync: refresh state from the persistent snapshot ──
    socket.on("sync_game_state", async (_data, cb) => {
      const user = socketToUser.get(socket.id);
      if (!user) return cb?.({ error: "Authentication required" });

      const snapshot = await getActiveOnlineGameForUser(user.userId);
      if (!snapshot || snapshot.status !== "active") return cb?.({ error: "No active game found" });

      let room = rooms.get(snapshot.roomCode);
      if (!room) {
        const alreadyHydrated = rooms.get(snapshot.roomCode);
        room = alreadyHydrated ?? roomFromSnapshot(snapshot);
        if (!alreadyHydrated) rooms.set(snapshot.roomCode, room);
      } else if (room.snapshotVersion !== snapshot.version) {
        room.state = JSON.parse(snapshot.stateJson) as GameState;
        room.snapshotVersion = snapshot.version;
      }

      const role: Player | null = room.userMap.p1 === user.userId ? "p1" : room.userMap.p2 === user.userId ? "p2" : null;
      if (!role || !room.state) return cb?.({ error: "Not a player in this game" });

      room.playerMap[role] = socket.id;
      if (role === "p1") room.hostSocket = socket.id;
      else room.guestSocket = socket.id;
      socketToRoom.set(socket.id, snapshot.roomCode);
      userToRoom.set(user.userId, snapshot.roomCode);
      socket.join(snapshot.roomCode);

      const opponentRole: Player = role === "p1" ? "p2" : "p1";
      const view = getPlayerView(room.state, role);
      socket.emit("game_state", {
        ...view,
        currentPlayer: view.turn,
        myRole: role,
        myName: room.nameMap[role],
        opponentName: room.nameMap[opponentRole],
        roomCode: snapshot.roomCode,
        turnTimeoutMs: TURN_TIMEOUT_MS,
        turnTimeLeftMs: Math.max(0, (room.state.turnStartedAt + room.state.turnTimeoutMs) - Date.now()),
        synchronized: true,
      });
      startTurnTimer(io, room);
      cb?.({ ok: true, version: snapshot.version });
    });

    // ── Disconnect ──
    socket.on("disconnect", () => {
      const roomCode = socketToRoom.get(socket.id);
      if (roomCode) {
        const room = rooms.get(roomCode);
        if (room) {
          // Remove spectator
          room.spectators.delete(socket.id);

          // If a player disconnected during a game — start grace period
          if (room.state && room.state.phase !== "game_over") {
            const player = getPlayerRole(room, socket.id);
            if (player) {
              const userId = room.userMap[player];
              const userName = room.nameMap[player];

              // Notify opponent of temporary disconnection
              const opponentRole: Player = player === "p1" ? "p2" : "p1";
              io.to(room.playerMap[opponentRole]).emit("opponent_disconnected_temp", {
                name: userName,
                gracePeriodMs: RECONNECT_GRACE_MS,
              });

              // Schedule walkover after grace period
              const disconnectedAt = Date.now();
              const timer = setTimeout(() => { void (async () => {
                const stillDisconnected = room.disconnectedPlayers.has(player);
                if (stillDisconnected && room.state && room.state.phase !== "game_over") {
                  const persisted = await getActiveOnlineGameByRoom(roomCode);
                  const reconnectedAt = player === "p1" ? persisted?.player1ReconnectedAt : persisted?.player2ReconnectedAt;
                  const reconnectedElsewhere = Boolean(
                    persisted?.status === "active" &&
                    reconnectedAt &&
                    new Date(reconnectedAt).getTime() >= Math.floor(disconnectedAt / 1_000) * 1_000,
                  );
                  if (reconnectedElsewhere) {
                    room.state = JSON.parse(persisted!.stateJson) as GameState;
                    room.snapshotVersion = persisted!.version;
                    room.disconnectedPlayers.delete(player);
                    return;
                  }
                  const winner: Player = player === "p1" ? "p2" : "p1";
                  io.to(roomCode).emit("opponent_disconnected", {
                    winnerName: room.nameMap[winner],
                  });
                  endOnlineGame(io, room, winner, true);
                  room.disconnectedPlayers.delete(player);
                  userToRoom.delete(userId);
                  socketToRoom.delete(room.playerMap[player]);  // ← Clean up socket mapping
                }
              })(); }, RECONNECT_GRACE_MS);

              room.disconnectedPlayers.set(player, { userId, userName, disconnectedAt: Date.now(), timer });
              userToRoom.set(userId, roomCode); // keep mapping for reconnection
            }
          }

          // Cleanup waiting rooms (no game started yet)
          if (!room.state && !room.guestSocket && room.hostSocket === socket.id) {
            rooms.delete(roomCode);
            userToRoom.delete(room.hostUserId);
            broadcastWaitingRooms();
            db().then(d => d.update(onlineRooms)
              .set({ status: "abandoned" })
              .where(eq(onlineRooms.code, roomCode)))
              .catch(() => {});
          }
        }
        socketToRoom.delete(socket.id);
      }

      // Remove from matchmaking queue
      const qIdx = matchmakingQueue.findIndex(q => q.socketId === socket.id);
      if (qIdx >= 0) matchmakingQueue.splice(qIdx, 1);

       socketToUser.delete(socket.id);
      console.log(`[Socket] Disconnected: ${socket.id} from room ${roomCode || 'none'}`);
      // Broadcast updated stats after disconnect
      setTimeout(broadcastOnlineStats, 200);
    });
  });
  return io;
}

// ── Helper: start game in room ──
async function startGame(io: Server, code: string) {
  const room = rooms.get(code);
  console.log(`[startGame] code=${code}, room exists=${!!room}, guestSocket=${room?.guestSocket}`);
  if (!room || !room.guestSocket) {
    console.log(`[startGame] SKIPPED: room=${!!room}, guestSocket=${room?.guestSocket}`);
    return;
  }

  // Use cryptographically random seed — avoids timestamp collisions when
  // multiple games start simultaneously. crypto.randomInt is Node 14.10+.
  const seed = randomInt(2147483646) + 1; // range [1, 2^31-2]
  let state = createGameState(seed);
  state = dealHand(state);
  room.state = state;
  room.startTime = Date.now();

  try {
    const snapshot = await createActiveOnlineGame({
      roomCode: room.code,
      player1Id: room.userMap.p1,
      player1Name: room.nameMap.p1,
      player2Id: room.userMap.p2,
      player2Name: room.nameMap.p2,
      stateJson: JSON.stringify(state),
      version: 1,
      status: "active",
      turnDeadline: getTurnDeadline(state),
      lastEventId: "game_started",
    });
    room.snapshotVersion = snapshot?.version ?? 1;
  } catch (error) {
    room.state = null;
    io.to(code).emit("game_error", { message: "Não foi possível preparar a partida on-line. Tente novamente." });
    console.error(`[startGame] Snapshot creation failed for ${code}:`, error);
    return;
  }
  playersInGame += 2; // Atomic counter: 2 players entered an active game

  console.log(`[startGame] Starting game in room ${code}`);
  // IMPORTANTE: emitir game_started PRIMEIRO para o cliente mostrar a tela
  // de jogo antes de receber o game_state com as cartas. Se game_state chegar
  // antes, o renderOnlineGame() acontece numa tela invisível e o jogo aparece em branco.
  io.to(code).emit("game_started", {
    names: room.nameMap,
    mode: room.mode,
    seed,
  });
  // Pequeno delay para garantir que o cliente processou o game_started e
  // mostrou a tela antes de receber o estado do jogo.
  setTimeout(() => {
    emitGameState(io, room);
  }, 150);
}

// ── Helper: compute which actions a player can take ──
function computeCanActions(state: GameState, player: Player) {
  const isPlaying = state.phase === 'playing';
  const isMyTurn = state.turn === player;
  // canTruco: playing phase, my turn, not at max level, not the last caller
  const canTruco = isPlaying && isMyTurn &&
    state.trucoLevel < 4 &&
    state.lastTrucoCaller !== player;
  // In gaúcho truco, flor substitutes envido. A player who holds flor cannot
  // call envido — and if *either* player has flor, envido is blocked entirely
  // because the flor takes priority. The condition checks:
  //   1. Playing phase, my turn
  //   2. No card played yet (first round only)
  //   3. Envido not already resolved
  //   4. Neither player has flor in hand (flor replaces envido)
  const anyoneHasFlor = state.hasFlor.p1 || state.hasFlor.p2;
  const canEnvido = isPlaying && isMyTurn &&
    !state.envidoResolved &&
    !state.playedFirst[player] &&
    !anyoneHasFlor;
  // canFlor: playing phase, my turn, I have flor, envido not resolved
  // Flor is independent of the envido state — it replaces envido entirely.
  const canFlor = isPlaying && isMyTurn &&
    state.hasFlor[player] &&
    !state.envidoResolved &&
    state.florChain.length === 0; // only if flor hasn’t been called yet
  return { canTruco, canEnvido, canFlor };
}

// ── Helper: clear turn timer ──
function clearTurnTimer(room: RoomData) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnTimerPlayer = null;
  }
}

// ── Helper: start turn timer (auto-fold after 30s) ──
function startTurnTimer(io: Server, room: RoomData) {
  clearTurnTimer(room);
  if (!room.state || ['waiting', 'between_hands', 'game_over'].includes(room.state.phase)) return;

  const currentPlayer = room.state.turn;
  room.turnTimerPlayer = currentPlayer;
  const remainingMs = Math.max(1, (room.state.turnStartedAt + TURN_TIMEOUT_MS) - Date.now());

  room.turnTimer = setTimeout(() => { void (async () => {
    // Guard: game may have ended, entered a transition, or changed turn.
    if (!room.state
      || ['waiting', 'between_hands', 'game_over'].includes(room.state.phase)
      || room.state.turn !== currentPlayer) return;

    console.log(`[TurnTimeout] Player ${currentPlayer} (${room.nameMap[currentPlayer]}) timed out in room ${room.code}`);

    // Notify both players about the timeout
    io.to(room.code).emit("turn_timeout", {
      player: currentPlayer,
      playerName: room.nameMap[currentPlayer],
    });

    // Auto-fold the timed-out player
    try {
      const result = fold(room.state!, currentPlayer);
      room.state = result.state;
      if (!await persistAndEmitGameState(io, room, "turn_timeout")) return;
      io.to(room.code).emit("player_folded", {
        folderName: room.nameMap[currentPlayer],
        winnerName: room.nameMap[result.handWinner],
        reason: "timeout",
      });
      if (result.gameWinner) {
        endOnlineGame(io, room, result.gameWinner);
      } else {
        setTimeout(() => { void dealNextHand(io, room, "next_hand:turn_timeout"); }, 1500);
      }
    } catch (e: any) {
      console.error(`[TurnTimeout] Error during auto-fold: ${e.message}`);
    }
  })(); }, remainingMs);
}

async function persistAndEmitGameState(io: Server, room: RoomData, eventId: string): Promise<boolean> {
  const saved = await persistRoomState(room, eventId);
  if (!saved) {
    emitGameState(io, room);
    return false;
  }
  emitGameState(io, room);
  return true;
}

async function dealNextHand(io: Server, room: RoomData, eventId: string) {
  if (!room.state || room.state.phase === "game_over") return;
  room.state = dealHand(room.state);
  await persistAndEmitGameState(io, room, eventId);
}

// ── Helper: emit game state to each player (hiding opponent cards) ──
function emitGameState(io: Server, room: RoomData) {
  if (!room.state) return;
  const p1View = getPlayerView(room.state, "p1");
  const p2View = getPlayerView(room.state, "p2");
  const p1Actions = computeCanActions(room.state, "p1");
  const p2Actions = computeCanActions(room.state, "p2");

  // Include turn timer info so frontend can show countdown
  const turnTimeLeft = Math.max(
    0,
    (room.state.turnStartedAt + TURN_TIMEOUT_MS) - Date.now(),
  );

  io.to(room.playerMap.p1).emit("game_state", {
    ...p1View,
    currentPlayer: p1View.turn,
    myRole: "p1",
    opponentName: room.nameMap.p2,
    myName: room.nameMap.p1,
    ...p1Actions,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    turnTimeLeftMs: turnTimeLeft,
  });
  io.to(room.playerMap.p2).emit("game_state", {
    ...p2View,
    currentPlayer: p2View.turn,
    myRole: "p2",
    opponentName: room.nameMap.p1,
    myName: room.nameMap.p2,
    ...p2Actions,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    turnTimeLeftMs: turnTimeLeft,
  });

  // Spectators get limited view
  for (const specId of Array.from(room.spectators)) {
    io.to(specId).emit("spectator_state", {
      score: room.state.score,
      roundWins: room.state.roundWins,
      phase: room.state.phase,
      table: room.state.table,
      names: room.nameMap,
    });
  }

  // Start turn timer for the current player
  startTurnTimer(io, room);
}

// ── Helper: end game and persist ──
async function endOnlineGame(io: Server, room: RoomData, winner: Player, isWalkover = false) {
  // Guard: prevent double-call if game already ended
  if (!room.state || room.state.phase === "game_over") return;
  clearTurnTimer(room); // Stop turn timer when game ends
  room.state.phase = "game_over";
  room.state.winner = winner;
  if (!await persistRoomState(room, `game_over:${winner}`)) {
    return;
  }
  playersInGame = Math.max(0, playersInGame - 2); // Atomic counter: 2 players left the game

  const duration = Math.floor((Date.now() - room.startTime) / 1000);

  io.to(room.code).emit("game_over", {
    winner,
    winnerName: room.nameMap[winner],
    score: room.state.score,
    isWalkover,
  });

  // Persist match result
  try {
    await (await db()).insert(onlineMatches).values({
      roomCode: room.code,
      player1Id: room.userMap.p1,
      player1Name: room.nameMap.p1,
      player2Id: room.userMap.p2,
      player2Name: room.nameMap.p2,
      winnerId: room.userMap[winner],
      scoreP1: room.state.score.p1,
      scoreP2: room.state.score.p2,
      mode: room.mode,
      durationSeconds: duration,
      tournamentId: room.tournamentId,
      isWalkover: isWalkover,
    });

    await (await db()).update(onlineRooms)
      .set({ status: "finished" })
      .where(eq(onlineRooms.code, room.code));

    // If this was a tournament match, update bracket and notify watchers
    if (room.tournamentId) {
      const winnerId = room.userMap[winner];
      const winnerName = room.nameMap[winner];

      // Emit match result to tournament room watchers
      io.to(`tournament_${room.tournamentId}`).emit("tournament_match_result", {
        tournamentId: room.tournamentId,
        winnerId,
        winnerName,
        scoreP1: room.state.score.p1,
        scoreP2: room.state.score.p2,
        roomCode: room.code,
      });

      // Advance bracket: update bracketData with winner and check if round is complete
      await advanceTournamentBracket(io, room.tournamentId, winnerId, winnerName);
    }
  } catch (e) { console.error("[Socket] DB save match error:", e); }

  // Cleanup after delay
  setTimeout(() => {
    rooms.delete(room.code);
  }, 30000);
}

// ── Helper: get room for socket ──
function getRoomForSocket(socketId: string): RoomData | null {
  const code = socketToRoom.get(socketId);
  if (!code) return null;
  return rooms.get(code) || null;
}

// ── Helper: get player role ──
function getPlayerRole(room: RoomData, socketId: string): Player | null {
  if (room.playerMap.p1 === socketId) return "p1";
  if (room.playerMap.p2 === socketId) return "p2";
  return null;
}

// ── Online Tournament: start bracket ──
async function startOnlineTournament(io: Server, tournamentId: number) {
  const d3 = await db();
  const [tournament] = await d3.select().from(onlineTournaments)
    .where(eq(onlineTournaments.id, tournamentId));
  if (!tournament) return;

  const players = await d3.select().from(onlineTournamentPlayers)
    .where(eq(onlineTournamentPlayers.tournamentId, tournamentId));

  const bracket = buildOneVsOneOpeningRound(players.map((player) => ({
    userId: player.userId,
    userName: player.userName,
  })));
  const drawnOrder = bracket.flatMap((match) => [match.p1UserId, match.p2UserId].filter((id): id is number => id !== null));
  await Promise.all(drawnOrder.map((userId, index) =>
    d3.update(onlineTournamentPlayers)
      .set({ seed: index + 1 })
      .where(and(eq(onlineTournamentPlayers.tournamentId, tournamentId), eq(onlineTournamentPlayers.userId, userId))),
  ));

  await prepareTournamentRound(d3, tournamentId, bracket);

  await d3.update(onlineTournaments)
    .set({
      status: "active",
      bracketData: JSON.stringify({ format: "1v1", drawCompletedAt: new Date().toISOString(), rounds: [bracket], currentRound: 0 }),
    })
    .where(eq(onlineTournaments.id, tournamentId));

  io.to(`tournament_${tournamentId}`).emit("tournament_started", {
    tournamentId,
    bracket,
    round: 0,
  });

  // Create rooms for first round matches
  for (const match of bracket) {
    notifyTournamentMatchReady(io, tournamentId, match);
  }
}

/** Creates the private 1×1 room that belongs to each playable bracket match. */
async function prepareTournamentRound(
  database: Awaited<ReturnType<typeof db>>,
  tournamentId: number,
  matches: OnlineTournamentMatch[],
) {
  for (const match of matches) {
    if (match.p2UserId === null || match.roomCode) continue;
    const roomCode = genCode();
    await database.insert(onlineRooms).values({
      code: roomCode,
      hostId: match.p1UserId,
      hostName: match.p1Name,
      guestId: null,
      guestName: null,
      mode: "1v1",
      stakeTier: "amistoso",
      region: "BR",
      isPrivate: true,
      privateInviteeId: match.p2UserId,
      status: "waiting",
      tournamentId,
    });
    match.roomCode = roomCode;
  }
}

/** Delivers a private match code only to the two players assigned to it. */
function notifyTournamentMatchReady(io: Server, tournamentId: number, match: OnlineTournamentMatch) {
  if (!match.roomCode || match.p2UserId === null) return;
  socketToUser.forEach((connectedUser, socketId) => {
    if (connectedUser.userId !== match.p1UserId && connectedUser.userId !== match.p2UserId) return;
    io.to(socketId).emit("tournament_match_ready", {
      tournamentId,
      roomCode: match.roomCode,
      opponentName: connectedUser.userId === match.p1UserId ? match.p2Name : match.p1Name,
      role: connectedUser.userId === match.p1UserId ? "host" : "guest",
      round: match.round,
      matchIndex: match.matchIndex,
    });
  });
}

// ── Online Tournament: advance bracket after a match ──
async function advanceTournamentBracket(io: Server, tournamentId: number, winnerId: number, winnerName: string) {
  try {
    const d = await db();
    const [tournament] = await d.select().from(onlineTournaments)
      .where(eq(onlineTournaments.id, tournamentId));
    if (!tournament || !tournament.bracketData) return;

    let bracketData: { rounds: OnlineTournamentMatch[][]; currentRound: number };
    try {
      bracketData = JSON.parse(tournament.bracketData);
    } catch { return; }

    const currentRound = bracketData.currentRound;
    const currentMatches = bracketData.rounds[currentRound];
    if (!currentMatches) return;

    // Mark the winner in the match where this player participated
    let matchUpdated = false;
    for (const match of currentMatches) {
      if ((match.p1UserId === winnerId || match.p2UserId === winnerId) && !match.winnerId) {
        match.winnerId = winnerId;
        match.winnerName = winnerName;
        matchUpdated = true;
        break;
      }
    }
    if (!matchUpdated) return;

    // Check if all matches in current round are done (or BYE — p2UserId === null)
    const allDone = currentMatches.every(m => m.winnerId || m.p2UserId === null);

    if (allDone) {
      // Collect winners (including BYE auto-advances where p2 is null)
      const winners = currentMatches.map(m => ({
        userId: m.winnerId || m.p1UserId,
        userName: m.winnerName || m.p1Name,
      }));

      // Notify players of BYE auto-advances
      for (const match of currentMatches) {
        if (match.p2UserId === null && !match.winnerId) {
          // This is a BYE match — p1 advances automatically
          io.to(`tournament_${tournamentId}`).emit("tournament_match_result", {
            tournamentId,
            winnerId: match.p1UserId,
            winnerName: match.p1Name,
            reason: "bye",
            scoreP1: 3,
            scoreP2: 0,
            roomCode: null,
          });
        }
      }

      if (winners.length === 1) {
        // Tournament complete!
        let certificate: { key: string; url: string } | null = null;
        try {
          certificate = await createChampionCertificate({
            tournamentId,
            tournamentName: tournament.name,
            championName: winners[0].userName,
            completedAt: new Date(),
          });
        } catch (certificateError) {
          console.error(`[Tournament] Certificate generation failed for ${tournamentId}:`, certificateError);
        }
        await d.update(onlineTournaments)
          .set({
            status: "completed",
            bracketData: JSON.stringify(bracketData),
            completedAt: new Date(),
            championCertificateKey: certificate?.key ?? null,
            championCertificateUrl: certificate?.url ?? null,
          })
          .where(eq(onlineTournaments.id, tournamentId));

        io.to(`tournament_${tournamentId}`).emit("tournament_completed", {
          tournamentId,
          championId: winners[0].userId,
          championName: winners[0].userName,
          certificateReady: Boolean(certificate),
        });
        if (certificate) {
          socketToUser.forEach((connectedUser, socketId) => {
            if (connectedUser.userId === winners[0].userId) {
              io.to(socketId).emit("tournament_certificate_ready", {
                tournamentId,
                tournamentName: tournament.name,
                certificateUrl: certificate!.url,
              });
            }
          });
        }
        // Carry full bracket in payload so clients do not need an extra fetch
        io.to(`tournament_${tournamentId}`).emit("tournament_bracket_updated", {
          tournamentId,
          bracketData,
        });
        return;
      }

      // Build next round — use null for empty slots, never 0
      const nextRoundIndex = currentRound + 1;
      const nextRound: OnlineTournamentMatch[] = [];
      for (let i = 0; i < winners.length; i += 2) {
        nextRound.push({
          round: nextRoundIndex,
          matchIndex: Math.floor(i / 2),
          p1UserId: winners[i].userId,
          p2UserId: winners[i + 1]?.userId ?? null,
          p1Name: winners[i].userName,
          p2Name: winners[i + 1]?.userName ?? null,
        });
      }

      bracketData.rounds.push(nextRound);
      bracketData.currentRound = nextRoundIndex;

      await prepareTournamentRound(d, tournamentId, nextRound);

      await d.update(onlineTournaments)
        .set({
          bracketData: JSON.stringify(bracketData),
          currentRound: nextRoundIndex,
        })
        .where(eq(onlineTournaments.id, tournamentId));

      io.to(`tournament_${tournamentId}`).emit("tournament_round_advanced", {
        tournamentId,
        round: nextRoundIndex,
        matches: nextRound,
      });
      nextRound.forEach((match) => notifyTournamentMatchReady(io, tournamentId, match));
    } else {
      // Just update bracketData with the winner mark
      await d.update(onlineTournaments)
        .set({ bracketData: JSON.stringify(bracketData) })
        .where(eq(onlineTournaments.id, tournamentId));
    }

    // Always notify bracket watchers — carry full bracketData in payload so
    // clients can update their local state without an extra tRPC round-trip.
    io.to(`tournament_${tournamentId}`).emit("tournament_bracket_updated", {
      tournamentId,
      bracketData,
    });
  } catch (e) {
    console.error("[Socket] advanceTournamentBracket error:", e);
  }
}
