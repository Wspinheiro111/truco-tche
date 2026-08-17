import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, matches, InsertMatch, pinResetTokens, onlineMatches, onlineRooms, onlineTournaments, onlineTournamentPlayers, sponsors, InsertSponsor, sponsorEvents, pilasBalance, pilasTransactions, pilasPackages, pixPayments, InsertPilasTransaction, userPurchases, activeOnlineGames, InsertActiveOnlineGame, pushSubscriptions, tournamentPushDeliveries, scheduledJobs } from "../drizzle/schema";
import { ENV } from './_core/env';

import mysql from 'mysql2/promise';

// @ts-ignore - Pool type mismatch between mysql2 versions
let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

// Cria um pool MySQL com keepAlive e reconexão automática.
// O pool substitui a conexão única anterior que morria após ECONNRESET
// (MySQL encerra conexões ociosas no Manus após ~8h de inatividade).
function createPool(): mysql.Pool {
  const url = process.env.DATABASE_URL!;
  // Parseia a URL para extrair os parâmetros (mysql://user:pass@host:port/db)
  const parsed = new URL(url);
  const pool = mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : 3306,
    user: parsed.username,
    password: parsed.password,
    database: parsed.pathname.replace(/^\//, ''),
    // Pool de conexões — evita sobrecarga e permite reuso
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 5,
    idleTimeout: 60000,      // descarta conexões ociosas após 60s
    // keepAlive previne ECONNRESET em conexões idle
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    // Reconecta automaticamente em caso de queda
    multipleStatements: false,
    // SSL obrigatório para TiDB Cloud
    ssl: {},
  });

  // Testa a conexão ao criar e loga o resultado
  pool.getConnection()
    .then(conn => { conn.release(); console.log('[Database] Pool conectado com sucesso'); })
    .catch(err => console.warn('[Database] Pool criado mas teste de conexão falhou:', err.message));

  return pool;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  // Unit tests use isolated in-memory expectations and must not create fixture
  // rows in the managed application database.
  if (process.env.VITEST || process.env.NODE_ENV === "test") return null;
  if (!process.env.DATABASE_URL) return null;

  // Se o pool existe e passou no health check, retorna
  if (_db && _pool) return _db;

  // Cria novo pool e instância drizzle
  try {
    _pool = createPool();
    _db = drizzle(_pool as any);
    return _db;
  } catch (error) {
    console.warn("[Database] Falha ao criar pool:", error);
    _pool = null;
    _db = null;
    return null;
  }
}

export type ChampionTournamentHistory = {
  id: number;
  name: string;
  prize: string | null;
  completedAt: Date | null;
  certificateUrl: string;
};

/** Retorna somente títulos cujo campeão confirmado é o usuário informado. */
export async function getChampionTournamentHistory(userId: number): Promise<ChampionTournamentHistory[]> {
  const database = await getDb();
  if (!database) return [];
  const tournaments = await database.select().from(onlineTournaments);
  return tournaments.flatMap(tournament => {
    if (tournament.status !== "completed" || !tournament.championCertificateUrl || !tournament.bracketData) return [];
    try {
      const bracket = JSON.parse(tournament.bracketData) as { rounds?: Array<Array<{ winnerId?: number | null }>> };
      const winnerId = bracket.rounds?.at(-1)?.[0]?.winnerId;
      if (winnerId !== userId) return [];
      return [{
        id: tournament.id,
        name: tournament.name,
        prize: tournament.prize,
        completedAt: tournament.completedAt,
        certificateUrl: tournament.championCertificateUrl,
      }];
    } catch {
      return [];
    }
  }).sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
}

async function getRawPool() {
  await getDb();
  if (!_pool) throw new Error("Database not available");
  return _pool;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    // Don't set lastSignedIn on creation — it will be set on actual login

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Local Auth (email + 6-digit PIN) ───────────────────────────────────────

/**
 * Sugestão 9: Normaliza o nome da cidade (trim + title case) para garantir
 * consistência nas buscas do ranking.
 */
export function normalizeCityName(city: string): string {
  // Use locale-aware case conversion to handle accented characters (ã, é, etc.)
  return city
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/(?:^|\s)\S/g, (c) => c.toLocaleUpperCase('pt-BR'));
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Assinaturas Web Push ─────────────────────────────────────────────────────

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
};

/** Mantém o endpoint fora de índices e logs; somente seu SHA-256 o identifica. */
export function hashPushEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export async function upsertPushSubscription(userId: number, input: PushSubscriptionInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const endpointHash = hashPushEndpoint(input.endpoint);
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: input.endpoint,
    endpointHash,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent ?? null,
  }).onDuplicateKeyUpdate({
    set: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      updatedAt: new Date(),
    },
  });
  const [subscription] = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpointHash, endpointHash))
    .limit(1);
  return subscription;
}

export async function removePushSubscription(userId: number, endpoint: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.endpointHash, hashPushEndpoint(endpoint)),
    ));
  return result.affectedRows > 0;
}

export async function listPushSubscriptionsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

export type TournamentPushTarget = {
  tournamentId: number;
  tournamentName: string;
  scheduledStartAt: Date;
  userId: number;
  subscriptionId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Busca somente inscrições com dispositivo autorizado em uma janela curta de lembretes. */
export async function listTournamentPushTargets(now: Date, minutesForward = 70): Promise<TournamentPushTarget[]> {
  const db = await getDb();
  if (!db) return [];
  const lowerBound = new Date(now.getTime() - 10 * 60 * 1000);
  const upperBound = new Date(now.getTime() + minutesForward * 60 * 1000);
  return db.select({
    tournamentId: onlineTournaments.id,
    tournamentName: onlineTournaments.name,
    scheduledStartAt: onlineTournaments.scheduledStartAt,
    userId: onlineTournamentPlayers.userId,
    subscriptionId: pushSubscriptions.id,
    endpoint: pushSubscriptions.endpoint,
    p256dh: pushSubscriptions.p256dh,
    auth: pushSubscriptions.auth,
  }).from(onlineTournaments)
    .innerJoin(onlineTournamentPlayers, eq(onlineTournamentPlayers.tournamentId, onlineTournaments.id))
    .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, onlineTournamentPlayers.userId))
    .where(and(
      eq(onlineTournaments.status, "registering"),
      isNotNull(onlineTournaments.scheduledStartAt),
      gt(onlineTournaments.scheduledStartAt, lowerBound),
      lt(onlineTournaments.scheduledStartAt, upperBound),
    ))
    .then(rows => rows.flatMap(row => row.scheduledStartAt ? [{ ...row, scheduledStartAt: row.scheduledStartAt }] : []));
}

/** Reserva uma entrega antes do envio para impedir duplicação entre retries ou instâncias. */
export async function claimTournamentPushDelivery(input: {
  tournamentId: number;
  userId: number;
  subscriptionId: number;
  reminderKind: "one_hour" | "fifteen_minutes";
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(tournamentPushDeliveries).values(input)
    .onDuplicateKeyUpdate({ set: { id: sql`${tournamentPushDeliveries.id}` } });
  return result.affectedRows === 1;
}

export async function removePushSubscriptionById(subscriptionId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
}

export async function recordScheduledJob(name: string, taskUid: string, cronExpression: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(scheduledJobs).values({ name, taskUid, cronExpression })
    .onDuplicateKeyUpdate({ set: { taskUid, cronExpression, updatedAt: new Date() } });
}

export async function isScheduledJobTask(name: string, taskUid: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [job] = await db.select({ id: scheduledJobs.id }).from(scheduledJobs)
    .where(and(eq(scheduledJobs.name, name), eq(scheduledJobs.taskUid, taskUid)))
    .limit(1);
  return Boolean(job);
}

export async function createLocalUser(data: {
  name: string;
  email: string;
  phone?: string;
  state?: string;
  city?: string;
  pinHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const openId = `local:${data.email.toLowerCase()}`;
  const normalizedCity = data.city ? normalizeCityName(data.city) : null;
  await db.insert(users).values({
    openId,
    name: data.name,
    email: data.email.toLowerCase(),
    phone: data.phone ?? null,
    state: data.state ?? null,
    city: normalizedCity,
    pinHash: data.pinHash,
    loginMethod: 'local',
    // lastSignedIn left null — will be set on first real login
  });
  return getUserByEmail(data.email.toLowerCase());
}

export async function updateUserPin(userId: number, pinHash: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({
    pinHash,
    updatedAt: new Date(),
    failedLoginAttempts: 0,
    lockedUntil: null,
  }).where(eq(users.id, userId));
}

export async function updateUserLastSignedIn(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({
    lastSignedIn: new Date(),
    failedLoginAttempts: 0,
    lockedUntil: null,
  }).where(eq(users.id, userId));
}

// ─── Vinculação de Conta Google ─────────────────────────────────────────────

/**
 * Links a Google/Manus OAuth account to an existing local account.
 * Updates the local user's openId to the OAuth openId so all history is preserved.
 * Also updates loginMethod to 'google' and sets googleLinked flag.
 * Returns the updated user.
 */
export async function linkGoogleAccount(localUserId: number, googleOpenId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  await db.update(users).set({
    openId: googleOpenId,
    loginMethod: 'google',
    googleLinked: true,
    lastSignedIn: new Date(),
    updatedAt: new Date(),
  }).where(eq(users.id, localUserId));
}

/**
 * Unlinks Google from a local account: restores the local:email openId format
 * and resets googleLinked to false.
 */
export async function unlinkGoogleAccount(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const user = await getUserById(userId);
  if (!user || !user.email) throw new Error('User not found or has no email');

  // Restore local: openId format
  const localOpenId = `local:${user.email.toLowerCase()}`;
  await db.update(users).set({
    openId: localOpenId,
    loginMethod: 'local',
    googleLinked: false,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}

// ─── Sugestão 2: Rate limiting / login lockout ────────────────────────────────

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * Records a failed login attempt and locks the account if threshold is reached.
 * Returns the updated user record.
 */
export async function recordFailedLogin(userId: number) {
  const db = await getDb();
  if (!db) return;

  const user = await getUserById(userId);
  if (!user) return;

  const attempts = (user.failedLoginAttempts ?? 0) + 1;
  const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = shouldLock
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
    : null;

  await db.update(users).set({
    failedLoginAttempts: attempts,
    lockedUntil: lockedUntil,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  return { attempts, lockedUntil };
}

/**
 * Checks if a user account is currently locked.
 * Returns { locked: true, until: Date } if locked, or { locked: false } if not.
 */
export function checkAccountLocked(user: { lockedUntil?: Date | null }) {
  if (!user.lockedUntil) return { locked: false };
  if (new Date() < user.lockedUntil) {
    return { locked: true, until: user.lockedUntil };
  }
  return { locked: false };
}

// ─── Sugestão 3: PIN Reset Tokens persistidos no banco ───────────────────────

/**
 * Stores a PIN reset token in the database with a 15-minute expiry.
 * Invalidates any existing unused tokens for this user first.
 */
export async function createPinResetToken(userId: number, token: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Mark old tokens for this user as used
  await db.update(pinResetTokens)
    .set({ used: true })
    .where(and(eq(pinResetTokens.userId, userId), eq(pinResetTokens.used, false)));

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.insert(pinResetTokens).values({ token, userId, expiresAt, used: false });
}

/**
 * Retrieves and validates a PIN reset token.
 * Returns the token record if valid, or null if expired/used/not found.
 */
export async function getPinResetToken(token: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select()
    .from(pinResetTokens)
    .where(and(
      eq(pinResetTokens.token, token),
      eq(pinResetTokens.used, false),
      gt(pinResetTokens.expiresAt, new Date()),
    ))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Marks a token as used after successful PIN reset.
 */
export async function consumePinResetToken(token: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [result] = await db.update(pinResetTokens)
    .set({ used: true })
    .where(and(
      eq(pinResetTokens.token, token),
      eq(pinResetTokens.used, false),
      gt(pinResetTokens.expiresAt, new Date()),
    ));
  return result.affectedRows === 1;
}

// ─── Match History ────────────────────────────────────────────────────────────

/**
 * Sugestão 5: Insere partida com scorePlayer e scoreOpponent como inteiros.
 * O campo score (string) é mantido por compatibilidade com dados existentes.
 */
export async function insertMatch(data: InsertMatch) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Auto-parse score string into integers if not provided
  let scorePlayer = data.scorePlayer ?? null;
  let scoreOpponent = data.scoreOpponent ?? null;

  if ((scorePlayer === null || scoreOpponent === null) && data.score) {
    const parts = data.score.replace('×', 'x').split('x');
    if (parts.length === 2) {
      const p = parseInt(parts[0]);
      const o = parseInt(parts[1]);
      if (!isNaN(p)) scorePlayer = p;
      if (!isNaN(o)) scoreOpponent = o;
    }
  }

  await db.insert(matches).values({ ...data, scorePlayer, scoreOpponent });
}

export async function getMatchHistory(userId: number, period: 'day' | 'week' | 'month' | 'year' | 'all') {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  let since: Date | null = null;

  if (period === 'day') {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'week') {
    const day = now.getDay();
    since = new Date(now);
    since.setDate(now.getDate() - day);
    since.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    since = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'year') {
    since = new Date(now.getFullYear(), 0, 1);
  }

  const conditions = [eq(matches.userId, userId)];
  if (since) conditions.push(gte(matches.playedAt, since));

  const result = await db
    .select()
    .from(matches)
    .where(and(...conditions))
    .orderBy(desc(matches.playedAt))
    .limit(200);

  return result;
}

// ── Online Match History ──
/**
 * Busca as últimas partidas online do usuário (como P1 ou P2).
 */
export async function getOnlineMatchHistory(userId: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const result = await db
    .select()
    .from(onlineMatches)
    .where(or(eq(onlineMatches.player1Id, userId), eq(onlineMatches.player2Id, userId)))
    .orderBy(desc(onlineMatches.playedAt))
    .limit(limit);
  return result;
}

// ── Active online game snapshots ─────────────────────────────────────────────

export type ActiveGameSnapshotInput = Omit<InsertActiveOnlineGame, "id" | "createdAt" | "updatedAt">;

export async function createActiveOnlineGame(snapshot: ActiveGameSnapshotInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(activeOnlineGames).values(snapshot);
  return getActiveOnlineGameByRoom(snapshot.roomCode);
}

export async function getActiveOnlineGameByRoom(roomCode: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(activeOnlineGames)
    .where(eq(activeOnlineGames.roomCode, roomCode))
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveOnlineGameForUser(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(activeOnlineGames)
    .where(and(
      eq(activeOnlineGames.status, "active"),
      or(eq(activeOnlineGames.player1Id, userId), eq(activeOnlineGames.player2Id, userId)),
    ))
    .orderBy(desc(activeOnlineGames.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Atualiza o snapshot apenas se a versão ainda corresponder ao estado lido. */
export async function updateActiveOnlineGame(
  roomCode: string,
  expectedVersion: number,
  update: Pick<ActiveGameSnapshotInput, "stateJson" | "turnDeadline" | "lastEventId" | "player1ReconnectedAt" | "player2ReconnectedAt"> & { status?: "active" | "finished" | "abandoned" },
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.update(activeOnlineGames)
    .set({ ...update, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(activeOnlineGames.roomCode, roomCode), eq(activeOnlineGames.version, expectedVersion)));
  return result[0].affectedRows === 1;
}

/**
 * Sugestão 6: Ranking global inclui todos os usuários (local + OAuth).
 * Sugestão 9: Filtro de cidade usa LOWER() para comparação case-insensitive.
 */
export async function getRanking(filters?: { state?: string; city?: string }) {
  const db = await getDb();
  if (!db) return [];

  try {
    let rawSql = sql`
      SELECT 
        u.id, u.name, u.state, u.city,
        COUNT(CASE WHEN m.result = 'win' THEN 1 END) as wins,
        COUNT(CASE WHEN m.result = 'lose' THEN 1 END) as losses,
        COUNT(*) as total,
        ROUND(COUNT(CASE WHEN m.result = 'win' THEN 1 END) * 100.0 / COUNT(*), 0) as winRate,
        AVG(m.scorePlayer) as avgScorePlayer,
        AVG(m.scoreOpponent) as avgScoreOpponent
      FROM users u
      LEFT JOIN matches m ON u.id = m.userId
      WHERE u.name IS NOT NULL
    `;

    if (filters?.state) {
      rawSql = sql`${rawSql} AND u.state = ${filters.state}`;
    }
    // Sugestão 9: comparação case-insensitive para cidade
    if (filters?.city) {
      rawSql = sql`${rawSql} AND LOWER(u.city) = LOWER(${filters.city.trim()})`;
    }

    rawSql = sql`${rawSql} GROUP BY u.id HAVING total > 0 ORDER BY wins DESC, winRate DESC LIMIT 100`;

    const result = await db.execute(rawSql);
    return Array.isArray(result) ? result : (result as any).rows || [];
  } catch (error) {
    console.error('[Database] getRanking error:', error);
    return [];
  }
}

// ─── Admin: User Management & Reports ─────────────────────────────────────────────

/**
 * List all users with match stats (admin).
 */
export async function listUsersWithStats(limit = 100, offset = 0) {
  const db = await getDb();
  if (!db) return { users: [], total: 0 };
  try {
    const countResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM users`);
    const total = Number((countResult as any)[0]?.cnt || 0);
    const result = await db.execute(sql`
      SELECT 
        u.id, u.name, u.email, u.phone, u.state, u.city, u.role, u.loginMethod,
        u.createdAt, u.lastSignedIn,
        COUNT(m.id) as totalMatches,
        COUNT(CASE WHEN m.result = 'win' THEN 1 END) as wins,
        COUNT(CASE WHEN m.result = 'lose' THEN 1 END) as losses
      FROM users u
      LEFT JOIN matches m ON u.id = m.userId
      GROUP BY u.id
      ORDER BY totalMatches DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return { users: Array.isArray(result) ? result : (result as any).rows || [], total };
  } catch (error) {
    console.error('[Admin] listUsersWithStats error:', error);
    return { users: [], total: 0 };
  }
}

/**
 * Search user by email (admin).
 */
export async function searchUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select().from(users)
    .where(sql`LOWER(${users.email}) LIKE LOWER(${`%${email}%`})`)
    .limit(20);
  return result;
}

/**
 * Delete a user and all their data (admin).
 */
export async function deleteUserById(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  // Delete matches
  await db.delete(matches).where(eq(matches.userId, userId));
  // Delete pin reset tokens
  await db.delete(pinResetTokens).where(eq(pinResetTokens.userId, userId));
  // Delete user
  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Get match statistics (daily/weekly/monthly counts) for admin dashboard.
 */
export async function getMatchStats() {
  const db = await getDb();
  if (!db) return { daily: 0, weekly: 0, monthly: 0, total: 0, dailyChart: [] };
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(todayStart.getDate() - todayStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN playedAt >= ${todayStart} THEN 1 END) as daily,
        COUNT(CASE WHEN playedAt >= ${weekStart} THEN 1 END) as weekly,
        COUNT(CASE WHEN playedAt >= ${monthStart} THEN 1 END) as monthly
      FROM matches
    `);
    const row = (Array.isArray(result) ? result[0] : (result as any).rows?.[0]) || {};

    // Last 14 days chart
    const chartResult = await db.execute(sql`
      SELECT DATE(playedAt) as day, COUNT(*) as cnt
      FROM matches
      WHERE playedAt >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      GROUP BY DATE(playedAt)
      ORDER BY day ASC
    `);
    const dailyChart = Array.isArray(chartResult) ? chartResult : (chartResult as any).rows || [];

    return {
      daily: Number(row.daily || 0),
      weekly: Number(row.weekly || 0),
      monthly: Number(row.monthly || 0),
      total: Number(row.total || 0),
      dailyChart: dailyChart.map((r: any) => ({ day: String(r.day), count: Number(r.cnt) })),
    };
  } catch (error) {
    console.error('[Admin] getMatchStats error:', error);
    return { daily: 0, weekly: 0, monthly: 0, total: 0, dailyChart: [] };
  }
}

/**
 * Get top players by number of matches played (admin).
 */
export async function getTopPlayers(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  try {
    const result = await db.execute(sql`
      SELECT 
        u.id, u.name, u.email, u.city, u.state,
        COUNT(m.id) as totalMatches,
        COUNT(CASE WHEN m.result = 'win' THEN 1 END) as wins,
        COUNT(CASE WHEN m.result = 'lose' THEN 1 END) as losses,
        ROUND(COUNT(CASE WHEN m.result = 'win' THEN 1 END) * 100.0 / NULLIF(COUNT(m.id), 0), 1) as winRate,
        MAX(m.playedAt) as lastPlayed
      FROM users u
      INNER JOIN matches m ON u.id = m.userId
      GROUP BY u.id
      ORDER BY totalMatches DESC
      LIMIT ${limit}
    `);
    return Array.isArray(result) ? result : (result as any).rows || [];
  } catch (error) {
    console.error('[Admin] getTopPlayers error:', error);
    return [];
  }
}

// ─── Sponsors CRUD ───────────────────────────────────────────────────────────

/**
 * List all sponsors (admin view — includes inactive).
 */
export async function listAllSponsors() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sponsors).orderBy(asc(sponsors.displayOrder), desc(sponsors.createdAt));
}

/**
 * List active sponsors only (public — for game banners).
 */
export async function listActiveSponsors() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sponsors).where(eq(sponsors.active, true)).orderBy(asc(sponsors.displayOrder));
}

/**
 * Get a single sponsor by ID.
 */
export async function getSponsorById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(sponsors).where(eq(sponsors.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new sponsor.
 */
export async function createSponsor(data: Omit<InsertSponsor, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.insert(sponsors).values(data);
  return result;
}

/**
 * Update an existing sponsor.
 */
export async function updateSponsor(id: number, data: Partial<Omit<InsertSponsor, 'id' | 'createdAt' | 'updatedAt'>>) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(sponsors).set({ ...data, updatedAt: new Date() }).where(eq(sponsors.id, id));
}

/**
 * Delete a sponsor.
 */
export async function deleteSponsor(id: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.delete(sponsors).where(eq(sponsors.id, id));
}

/**
 * Record a sponsor event (impression or click).
 * Upserts a daily aggregate row per sponsor+eventType.
 */
export async function recordSponsorEvent(sponsorId: number, eventType: 'impression' | 'click') {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // Try to increment existing row
  const existing = await db.select().from(sponsorEvents)
    .where(and(
      eq(sponsorEvents.sponsorId, sponsorId),
      eq(sponsorEvents.eventType, eventType),
      eq(sponsorEvents.eventDate, today)
    )).limit(1);
  if (existing.length > 0) {
    await db.update(sponsorEvents)
      .set({ count: sql`${sponsorEvents.count} + 1` })
      .where(eq(sponsorEvents.id, existing[0].id));
  } else {
    await db.insert(sponsorEvents).values({ sponsorId, eventType, eventDate: today, count: 1 });
  }
}

/**
 * Get sponsor metrics (impressions, clicks, CTR) for all sponsors.
 * Optionally filter by date range.
 */
export async function getSponsorMetrics(fromDate?: string, toDate?: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const conditions = [];
  if (fromDate) conditions.push(sql`${sponsorEvents.eventDate} >= ${fromDate}`);
  if (toDate) conditions.push(sql`${sponsorEvents.eventDate} <= ${toDate}`);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select({
    sponsorId: sponsorEvents.sponsorId,
    eventType: sponsorEvents.eventType,
    total: sql<number>`SUM(${sponsorEvents.count})`.as('total'),
  }).from(sponsorEvents)
    .where(whereClause)
    .groupBy(sponsorEvents.sponsorId, sponsorEvents.eventType);
  return rows;
}

/**
 * Get daily breakdown of sponsor events for a specific sponsor.
 */
export async function getSponsorDailyMetrics(sponsorId: number, fromDate?: string, toDate?: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const conditions = [eq(sponsorEvents.sponsorId, sponsorId)];
  if (fromDate) conditions.push(sql`${sponsorEvents.eventDate} >= ${fromDate}`);
  if (toDate) conditions.push(sql`${sponsorEvents.eventDate} <= ${toDate}`);
  const rows = await db.select().from(sponsorEvents)
    .where(and(...conditions))
    .orderBy(sponsorEvents.eventDate);
  return rows;
}

/**
 * Get today's impression count for a specific sponsor.
 */
export async function getTodayImpressions(sponsorId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.select({ count: sponsorEvents.count })
    .from(sponsorEvents)
    .where(and(
      eq(sponsorEvents.sponsorId, sponsorId),
      eq(sponsorEvents.eventType, 'impression'),
      eq(sponsorEvents.eventDate, today)
    ));
  return rows.length > 0 ? rows[0].count : 0;
}

// ─── Histórico administrativo das regras ─────────────────────────────────────

export type RulesTestFailureRecord = {
  title: string;
  group: string;
  detail?: string;
};

export type RulesTestExecutionInput = {
  status: 'passed' | 'failed';
  passedChecks: number;
  totalChecks: number;
  failedChecks: RulesTestFailureRecord[];
  executedById?: number;
  executedByName?: string | null;
};

export type RulesTestExecutionHistoryRow = mysql.RowDataPacket & {
  id: number;
  status: 'passed' | 'failed';
  passedChecks: number;
  totalChecks: number;
  failedChecksJson: string;
  executedById: number | null;
  executedByName: string | null;
  ownerNotified: number | boolean;
  createdAt: Date | string;
};

/** Persiste cada execução para auditoria; devolve null em testes sem banco. */
export async function recordRulesTestExecution(input: RulesTestExecutionInput): Promise<number | null> {
  const db = await getDb();
  if (!db || !_pool) return null;
  const [result] = await _pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO rulesTestExecutions
      (status, passedChecks, totalChecks, failedChecksJson, executedById, executedByName)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.status,
      input.passedChecks,
      input.totalChecks,
      JSON.stringify(input.failedChecks),
      input.executedById ?? null,
      input.executedByName ?? null,
    ],
  );
  return Number(result.insertId || 0) || null;
}

/** Registra se o alerta enviado ao proprietário do projeto foi aceito pelo serviço. */
export async function setRulesTestExecutionOwnerNotification(executionId: number, delivered: boolean): Promise<void> {
  const db = await getDb();
  if (!db || !_pool) return;
  await _pool.execute(
    `UPDATE rulesTestExecutions SET ownerNotified = ? WHERE id = ?`,
    [delivered, executionId],
  );
}

/** Retorna as execuções administrativas mais recentes, primeiro as mais novas. */
export async function listRecentRulesTestExecutions(limit = 15): Promise<RulesTestExecutionHistoryRow[]> {
  const db = await getDb();
  if (!db || !_pool) return [];
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  const [rows] = await _pool.query<RulesTestExecutionHistoryRow[]>(
    `SELECT id, status, passedChecks, totalChecks, failedChecksJson, executedById,
            executedByName, ownerNotified, createdAt
       FROM rulesTestExecutions
      ORDER BY createdAt DESC, id DESC
      LIMIT ?`,
    [safeLimit],
  );
  return rows;
}

/** Obtém uma execução específica para a exportação do diagnóstico administrativo. */
export async function getRulesTestExecution(executionId: number): Promise<RulesTestExecutionHistoryRow | null> {
  const db = await getDb();
  if (!db || !_pool) return null;
  const [rows] = await _pool.query<RulesTestExecutionHistoryRow[]>(
    `SELECT id, status, passedChecks, totalChecks, failedChecksJson, executedById,
            executedByName, ownerNotified, createdAt
       FROM rulesTestExecutions
      WHERE id = ?
      LIMIT 1`,
    [executionId],
  );
  return rows[0] ?? null;
}

// ─── Pilas (Moeda Virtual) ──────────────────────────────────────────────────

/**
 * Get or create a user's pilas balance.
 */
export async function getPilasBalance(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ balance: pilasBalance.balance })
    .from(pilasBalance)
    .where(eq(pilasBalance.userId, userId))
    .limit(1);
  if (rows.length > 0) return rows[0].balance;
  // Create initial balance
  await db.insert(pilasBalance).values({ userId, balance: 0, totalPurchased: 0, totalSpent: 0 });
  return 0;
}

/**
 * Credit pilas to a user (purchase or reward).
 * Returns the new balance.
 */
export async function creditPilas(userId: number, amount: number, description: string, referenceId?: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  if (amount <= 0) throw new Error('Credit amount must be positive');

  // Ensure balance row exists
  await getPilasBalance(userId);

  // Update balance
  await db.update(pilasBalance)
    .set({
      balance: sql`${pilasBalance.balance} + ${amount}`,
      totalPurchased: sql`${pilasBalance.totalPurchased} + ${amount}`,
    })
    .where(eq(pilasBalance.userId, userId));

  // Get new balance
  const rows = await db.select({ balance: pilasBalance.balance })
    .from(pilasBalance)
    .where(eq(pilasBalance.userId, userId))
    .limit(1);
  const newBalance = rows[0]?.balance ?? amount;

  // Record transaction
  await db.insert(pilasTransactions).values({
    userId,
    type: 'purchase',
    amount,
    description,
    referenceId: referenceId ?? null,
    balanceAfter: newBalance,
  });

  return newBalance;
}

/**
 * Debit pilas from a user (spend).
 * Returns the new balance or throws if insufficient funds.
 */
export async function debitPilas(userId: number, amount: number, description: string, referenceId?: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  if (amount <= 0) throw new Error('Debit amount must be positive');

  const currentBalance = await getPilasBalance(userId);
  if (currentBalance < amount) {
    throw new Error(`Saldo insuficiente: ${currentBalance} pilas disponíveis, ${amount} necessárias`);
  }

  // Update balance
  await db.update(pilasBalance)
    .set({
      balance: sql`${pilasBalance.balance} - ${amount}`,
      totalSpent: sql`${pilasBalance.totalSpent} + ${amount}`,
    })
    .where(eq(pilasBalance.userId, userId));

  const newBalance = currentBalance - amount;

  // Record transaction
  await db.insert(pilasTransactions).values({
    userId,
    type: 'spend',
    amount: -amount,
    description,
    referenceId: referenceId ?? null,
    balanceAfter: newBalance,
  });

  return newBalance;
}

/**
 * Get transaction history for a user.
 */
export async function getPilasTransactions(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(pilasTransactions)
    .where(eq(pilasTransactions.userId, userId))
    .orderBy(desc(pilasTransactions.createdAt))
    .limit(limit);
}

/**
 * List active pilas packages.
 */
export async function listPilasPackages() {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(pilasPackages)
    .where(eq(pilasPackages.active, true))
    .orderBy(asc(pilasPackages.displayOrder));
}

/**
 * Get a pilas package by ID.
 */
export async function getPilasPackageById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(pilasPackages).where(eq(pilasPackages.id, id)).limit(1);
  return rows[0];
}

/**
 * Create a Pix payment record.
 */
export async function createPixPaymentRecord(data: {
  userId: number;
  packageId: number;
  mpPaymentId: string;
  amountCents: number;
  pilasToCredit: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.insert(pixPayments).values({
    userId: data.userId,
    packageId: data.packageId,
    mpPaymentId: data.mpPaymentId,
    status: 'pending',
    amountCents: data.amountCents,
    pilasToCredit: data.pilasToCredit,
    credited: false,
    qrCode: data.qrCode,
    qrCodeBase64: data.qrCodeBase64,
    ticketUrl: data.ticketUrl,
    expiresAt: data.expiresAt,
  });
}

/**
 * Get a Pix payment by Mercado Pago payment ID.
 */
export async function getPixPaymentByMpId(mpPaymentId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(pixPayments)
    .where(eq(pixPayments.mpPaymentId, mpPaymentId))
    .limit(1);
  return rows[0];
}

/**
 * Update Pix payment status and credit pilas if approved.
 */
export async function updatePixPaymentStatus(mpPaymentId: string, status: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const payment = await getPixPaymentByMpId(mpPaymentId);
  if (!payment) return false;

  // Update status
  const newStatus = status === 'approved' ? 'approved' :
                    status === 'rejected' ? 'rejected' :
                    status === 'cancelled' ? 'cancelled' :
                    status === 'refunded' ? 'refunded' : 'pending';

  await db.update(pixPayments)
    .set({ status: newStatus as any })
    .where(eq(pixPayments.mpPaymentId, mpPaymentId));

  // Credit pilas if approved and not yet credited
  if (status === 'approved' && payment.credited === false) {
    await creditPilas(
      payment.userId,
      payment.pilasToCredit,
      `Compra de ${payment.pilasToCredit} pilas via Pix`,
      mpPaymentId
    );
    await db.update(pixPayments)
      .set({ credited: true })
      .where(eq(pixPayments.mpPaymentId, mpPaymentId));
    return true; // pilas credited
  }

  return false;
}

/**
 * Get pending Pix payments for a user.
 */
export async function getPendingPixPayments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pixPayments)
    .where(and(
      eq(pixPayments.userId, userId),
      eq(pixPayments.status, 'pending')
    ))
    .orderBy(desc(pixPayments.createdAt))
    .limit(5);
}

// ─── Pilas Packages Admin ───────────────────────────────────────────────────

/**
 * List all pilas packages (admin view — includes inactive).
 */
export async function listAllPilasPackages() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pilasPackages).orderBy(asc(pilasPackages.displayOrder));
}

/**
 * Create a pilas package.
 */
export async function createPilasPackage(data: { name: string; pilas: number; priceCents: number; bonusPilas?: number; badge?: string; displayOrder?: number }) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.insert(pilasPackages).values(data);
}

/**
 * Update a pilas package.
 */
export async function updatePilasPackage(id: number, data: Partial<{ name: string; pilas: number; priceCents: number; bonusPilas: number; badge: string; active: boolean; displayOrder: number }>) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(pilasPackages).set(data).where(eq(pilasPackages.id, id));
}

/**
 * Delete a pilas package.
 */
export async function deletePilasPackage(id: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.delete(pilasPackages).where(eq(pilasPackages.id, id));
}

// ─── User Purchases (Shop Items bought with Pilas) ──────────────────────────

/**
 * Get all purchases for a user.
 */
export async function getUserPurchases(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(userPurchases)
    .where(eq(userPurchases.userId, userId))
    .orderBy(desc(userPurchases.createdAt));
}

/**
 * Check if a user owns a specific shop item.
 */
export async function userOwnsItem(userId: number, category: string, itemId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: userPurchases.id })
    .from(userPurchases)
    .where(and(
      eq(userPurchases.userId, userId),
      eq(userPurchases.category, category),
      eq(userPurchases.itemId, itemId),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Record a shop item purchase with Pilas.
 * Debits pilas and records the purchase.
 * Returns the new pilas balance.
 */
export async function purchaseShopItem(userId: number, category: string, itemId: string, pricePilas: number): Promise<number> {
  // Check if already owned
  const alreadyOwned = await userOwnsItem(userId, category, itemId);
  if (alreadyOwned) throw new Error('Você já possui este item');

  // Debit pilas (throws if insufficient)
  const newBalance = await debitPilas(userId, pricePilas, `Compra: ${category}/${itemId}`, `shop:${category}:${itemId}`);

  // Record purchase
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  // Get the transaction ID from the pilas_transactions table
  // The debitPilas call above created a transaction with referenceId = `shop:${category}:${itemId}`
  const txRows = await db.select({ id: pilasTransactions.id })
    .from(pilasTransactions)
    .where(and(
      eq(pilasTransactions.userId, userId),
      eq(pilasTransactions.referenceId, `shop:${category}:${itemId}`)
    ))
    .orderBy(desc(pilasTransactions.createdAt))
    .limit(1);
  const txId = txRows.length > 0 ? txRows[0].id : null;

  await db.insert(userPurchases).values({
    userId,
    category,
    itemId,
    pricePilas,
    transactionId: txId,
  });

  return newBalance;
}

// ─── Admin Monitoring ─────────────────────────────────────────────────────────

/**
 * Returns a real-time snapshot for the admin monitoring panel:
 * - Active rooms (waiting + playing) with player names and status
 * - Online players count (unique users in active rooms)
 * - Recent online matches (last 20)
 * - Active tournaments with player counts
 * - Aggregate counters (total online matches today, total tournaments)
 */
export async function getAdminMonitoring() {
  const db = await getDb();
  if (!db) {
    return {
      activeRooms: [],
      onlinePlayersCount: 0,
      recentOnlineMatches: [],
      activeTournaments: [],
      todayOnlineMatches: 0,
      totalOnlineMatches: 0,
    };
  }

  try {
    // 1. Active rooms (waiting or playing)
    const activeRooms = await db
      .select({
        id: onlineRooms.id,
        code: onlineRooms.code,
        hostName: onlineRooms.hostName,
        guestName: onlineRooms.guestName,
        mode: onlineRooms.mode,
        status: onlineRooms.status,
        tournamentId: onlineRooms.tournamentId,
        createdAt: onlineRooms.createdAt,
        updatedAt: onlineRooms.updatedAt,
      })
      .from(onlineRooms)
      .where(sql`${onlineRooms.status} IN ('waiting', 'playing')`)
      .orderBy(desc(onlineRooms.createdAt))
      .limit(50);

    // 2. Count unique online players from active rooms
    const onlinePlayerIds = new Set<number>();
    const roomsWithIds = await db
      .select({ hostId: onlineRooms.hostId, guestId: onlineRooms.guestId })
      .from(onlineRooms)
      .where(sql`${onlineRooms.status} IN ('waiting', 'playing')`);
    for (const r of roomsWithIds) {
      if (r.hostId) onlinePlayerIds.add(r.hostId);
      if (r.guestId) onlinePlayerIds.add(r.guestId);
    }
    const onlinePlayersCount = onlinePlayerIds.size;

    // 3. Recent online matches (last 20)
    const recentOnlineMatches = await db
      .select({
        id: onlineMatches.id,
        roomCode: onlineMatches.roomCode,
        player1Name: onlineMatches.player1Name,
        player2Name: onlineMatches.player2Name,
        scoreP1: onlineMatches.scoreP1,
        scoreP2: onlineMatches.scoreP2,
        mode: onlineMatches.mode,
        durationSeconds: onlineMatches.durationSeconds,
        isWalkover: onlineMatches.isWalkover,
        tournamentId: onlineMatches.tournamentId,
        playedAt: onlineMatches.playedAt,
        // winner name via join
        winnerId: onlineMatches.winnerId,
      })
      .from(onlineMatches)
      .orderBy(desc(onlineMatches.playedAt))
      .limit(20);

    // 4. Active tournaments (registering + active) with player counts
    const activeTournaments = await db
      .select({
        id: onlineTournaments.id,
        name: onlineTournaments.name,
        status: onlineTournaments.status,
        maxPlayers: onlineTournaments.maxPlayers,
        currentRound: onlineTournaments.currentRound,
        totalRounds: onlineTournaments.totalRounds,
        prize: onlineTournaments.prize,
        createdAt: onlineTournaments.createdAt,
      })
      .from(onlineTournaments)
      .where(sql`${onlineTournaments.status} IN ('registering', 'active')`)
      .orderBy(desc(onlineTournaments.createdAt))
      .limit(20);

    // Enrich tournaments with player counts
    const tournamentsWithPlayers = await Promise.all(
      activeTournaments.map(async (t) => {
        const players = await db
          .select({ userId: onlineTournamentPlayers.userId, userName: onlineTournamentPlayers.userName, eliminated: onlineTournamentPlayers.eliminated })
          .from(onlineTournamentPlayers)
          .where(eq(onlineTournamentPlayers.tournamentId, t.id));
        return { ...t, currentPlayers: players.length, players };
      })
    );

    // 5. Aggregate counters
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todayResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM onlineMatches WHERE playedAt >= ${todayStart}
    `);
    const todayOnlineMatches = Number((Array.isArray(todayResult) ? todayResult[0] : (todayResult as any).rows?.[0])?.cnt || 0);

    const totalResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM onlineMatches`);
    const totalOnlineMatches = Number((Array.isArray(totalResult) ? totalResult[0] : (totalResult as any).rows?.[0])?.cnt || 0);

    return {
      activeRooms,
      onlinePlayersCount,
      recentOnlineMatches,
      activeTournaments: tournamentsWithPlayers,
      todayOnlineMatches,
      totalOnlineMatches,
    };
  } catch (error) {
    console.error('[Admin] getAdminMonitoring error:', error);
    return {
      activeRooms: [],
      onlinePlayersCount: 0,
      recentOnlineMatches: [],
      activeTournaments: [],
      todayOnlineMatches: 0,
      totalOnlineMatches: 0,
    };
  }
}

// ─── Online Tournament Bracket ────────────────────────────────────────────────

/**
 * Bracket match shape (stored in bracketData JSON).
 */
export interface BracketMatch {
  round: number;
  matchIndex: number;
  p1UserId: number;
  p2UserId: number;
  p1Name: string;
  p2Name: string;
  winnerId?: number;
  winnerName?: string;
  scoreP1?: number;
  scoreP2?: number;
  status?: "pending" | "playing" | "done" | "bye";
}

export interface BracketData {
  rounds: BracketMatch[][];
  currentRound: number;
}

/**
 * Returns full bracket data for a tournament, enriched with match results
 * from the onlineMatches table.
 */
export async function getTournamentBracket(tournamentId: number) {
  const db = await getDb();
  if (!db) return null;

  const [tournament] = await db
    .select()
    .from(onlineTournaments)
    .where(eq(onlineTournaments.id, tournamentId))
    .limit(1);

  if (!tournament) return null;

  const players = await db
    .select()
    .from(onlineTournamentPlayers)
    .where(eq(onlineTournamentPlayers.tournamentId, tournamentId));

  // Parse stored bracket
  let bracketData: BracketData | null = null;
  if (tournament.bracketData) {
    try {
      bracketData = JSON.parse(tournament.bracketData) as BracketData;
    } catch {
      bracketData = null;
    }
  }

  // Fetch all match results for this tournament
  const matchResults = await db
    .select()
    .from(onlineMatches)
    .where(eq(onlineMatches.tournamentId, tournamentId))
    .orderBy(asc(onlineMatches.playedAt));

  // Build a map: "p1UserId-p2UserId" → match result
  const resultMap = new Map<string, typeof matchResults[0]>();
  for (const m of matchResults) {
    const key1 = `${m.player1Id}-${m.player2Id}`;
    const key2 = `${m.player2Id}-${m.player1Id}`;
    resultMap.set(key1, m);
    resultMap.set(key2, m);
  }

  // Enrich bracket rounds with results
  let enrichedRounds: BracketMatch[][] = [];
  if (bracketData?.rounds) {
    enrichedRounds = bracketData.rounds.map((round) =>
      round.map((match) => {
        // BYE match: p2UserId is null (empty slot — never 0 to avoid ID collision)
        if (match.p2UserId === null || match.p2UserId === undefined) {
          return { ...match, status: "bye" as const, winnerName: match.p1Name };
        }
        const key = `${match.p1UserId}-${match.p2UserId}`;
        const result = resultMap.get(key);
        if (result) {
          const winnerName =
            result.winnerId === match.p1UserId ? match.p1Name : match.p2Name;
          return {
            ...match,
            winnerId: result.winnerId,
            winnerName,
            scoreP1: result.player1Id === match.p1UserId ? result.scoreP1 : result.scoreP2,
            scoreP2: result.player1Id === match.p1UserId ? result.scoreP2 : result.scoreP1,
            status: "done" as const,
          };
        }
        // Check if this is the current round and match is pending/playing
        const isCurrentRound = match.round === (bracketData?.currentRound ?? 0);
        return {
          ...match,
          status: isCurrentRound ? ("pending" as const) : ("pending" as const),
        };
      })
    );
  }

  return {
    id: tournament.id,
    creatorId: tournament.creatorId,
    name: tournament.name,
    status: tournament.status,
    maxPlayers: tournament.maxPlayers,
    currentRound: tournament.currentRound,
    totalRounds: tournament.totalRounds,
    prize: tournament.prize,
    scheduledStartAt: tournament.scheduledStartAt,
    createdAt: tournament.createdAt,
    completedAt: tournament.completedAt,
    players: players.map((p) => ({
      userId: p.userId,
      userName: p.userName,
      seed: p.seed,
      eliminated: p.eliminated,
    })),
    rounds: enrichedRounds,
    currentRoundIndex: bracketData?.currentRound ?? 0,
  };
}

// ─── Friends and private invitation data ─────────────────────────────────────

export type FriendListItem = {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  friendshipId: number;
  since: Date;
};

export async function searchFriendCandidates(userId: number, search: string) {
  const pool = await getRawPool();
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id, name, city, state FROM users WHERE id <> ? AND name LIKE ? ORDER BY name ASC LIMIT 12`,
    [userId, `%${search.trim()}%`],
  );
  return rows.map(row => ({ id: Number(row.id), name: String(row.name ?? "Jogador"), city: row.city ? String(row.city) : null, state: row.state ? String(row.state) : null }));
}

export async function listFriends(userId: number): Promise<FriendListItem[]> {
  const pool = await getRawPool();
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT f.id AS friendshipId, f.createdAt AS sinceDate,
      CASE WHEN f.requesterId = ? THEN u2.id ELSE u1.id END AS id,
      CASE WHEN f.requesterId = ? THEN u2.name ELSE u1.name END AS name,
      CASE WHEN f.requesterId = ? THEN u2.city ELSE u1.city END AS city,
      CASE WHEN f.requesterId = ? THEN u2.state ELSE u1.state END AS state
     FROM friendships f JOIN users u1 ON u1.id = f.requesterId JOIN users u2 ON u2.id = f.addresseeId
     WHERE (f.requesterId = ? OR f.addresseeId = ?) AND f.status = 'accepted' ORDER BY name ASC`,
    [userId, userId, userId, userId, userId, userId],
  );
  return rows.map(row => ({ id: Number(row.id), name: String(row.name ?? "Jogador"), city: row.city ? String(row.city) : null, state: row.state ? String(row.state) : null, friendshipId: Number(row.friendshipId), since: new Date(row.sinceDate) }));
}

export async function listIncomingFriendRequests(userId: number) {
  const pool = await getRawPool();
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT f.id, f.createdAt, u.id AS requesterId, u.name AS requesterName, u.city, u.state
     FROM friendships f JOIN users u ON u.id = f.requesterId
     WHERE f.addresseeId = ? AND f.status = 'pending' ORDER BY f.createdAt DESC`,
    [userId],
  );
  return rows.map(row => ({ id: Number(row.id), requesterId: Number(row.requesterId), requesterName: String(row.requesterName ?? "Jogador"), city: row.city ? String(row.city) : null, state: row.state ? String(row.state) : null, createdAt: new Date(row.createdAt) }));
}

export async function sendFriendRequest(requesterId: number, addresseeId: number) {
  if (requesterId === addresseeId) throw new Error("Não é possível adicionar a si mesmo");
  const pool = await getRawPool();
  const [existing] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id, requesterId, addresseeId, status FROM friendships WHERE (requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?) LIMIT 1`,
    [requesterId, addresseeId, addresseeId, requesterId],
  );
  const relation = existing[0];
  if (relation?.status === "accepted") return { status: "accepted" as const, autoAccepted: false };
  if (relation?.status === "pending" && Number(relation.requesterId) === addresseeId) {
    await pool.execute(`UPDATE friendships SET status = 'accepted', respondedAt = NOW() WHERE id = ?`, [relation.id]);
    return { status: "accepted" as const, autoAccepted: true };
  }
  if (relation?.status === "pending") return { status: "pending" as const, existing: true };
  if (relation) await pool.execute(`UPDATE friendships SET requesterId = ?, addresseeId = ?, status = 'pending', createdAt = NOW(), respondedAt = NULL WHERE id = ?`, [requesterId, addresseeId, relation.id]);
  else await pool.execute(`INSERT INTO friendships (requesterId, addresseeId, status) VALUES (?, ?, 'pending')`, [requesterId, addresseeId]);
  return { status: "pending" as const, existing: false };
}

export async function respondToFriendRequest(addresseeId: number, friendshipId: number, accept: boolean) {
  const pool = await getRawPool();
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE friendships SET status = ?, respondedAt = NOW() WHERE id = ? AND addresseeId = ? AND status = 'pending'`,
    [accept ? "accepted" : "declined", friendshipId, addresseeId],
  );
  return result.affectedRows === 1;
}

export async function removeFriend(userId: number, friendId: number) {
  const pool = await getRawPool();
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `DELETE FROM friendships WHERE (requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)`,
    [userId, friendId, friendId, userId],
  );
  return result.affectedRows === 1;
}

export async function areFriends(userId: number, friendId: number) {
  const pool = await getRawPool();
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM friendships WHERE ((requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)) AND status = 'accepted' LIMIT 1`,
    [userId, friendId, friendId, userId],
  );
  return rows.length > 0;
}

export async function createFriendGameInvite(senderId: number, receiverId: number, roomCode: string) {
  const pool = await getRawPool();
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO friendGameInvites (senderId, receiverId, roomCode, status, expiresAt)
     VALUES (?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 10 MINUTE))
     ON DUPLICATE KEY UPDATE receiverId = VALUES(receiverId), status = 'pending', expiresAt = DATE_ADD(NOW(), INTERVAL 10 MINUTE), respondedAt = NULL`,
    [senderId, receiverId, roomCode],
  );
  return Number(result.insertId || 0);
}

export async function listPendingFriendGameInvites(receiverId: number) {
  const pool = await getRawPool();
  await pool.execute(`UPDATE friendGameInvites SET status = 'expired' WHERE receiverId = ? AND status = 'pending' AND expiresAt <= NOW()`, [receiverId]);
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT i.id, i.roomCode, i.expiresAt, u.id AS senderId, u.name AS senderName, r.mode, r.stakeTier, r.region
     FROM friendGameInvites i JOIN users u ON u.id = i.senderId JOIN onlineRooms r ON r.code = i.roomCode
     WHERE i.receiverId = ? AND i.status = 'pending' AND r.status = 'waiting' ORDER BY i.createdAt DESC`,
    [receiverId],
  );
  return rows.map(row => ({ id: Number(row.id), roomCode: String(row.roomCode), senderId: Number(row.senderId), senderName: String(row.senderName ?? "Amigo"), mode: String(row.mode), stakeTier: String(row.stakeTier), region: String(row.region), expiresAt: new Date(row.expiresAt) }));
}

export async function claimFriendGameInvite(receiverId: number, roomCode: string) {
  const pool = await getRawPool();
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE friendGameInvites SET status = 'accepted', respondedAt = NOW()
     WHERE receiverId = ? AND roomCode = ? AND status = 'pending' AND expiresAt > NOW()`,
    [receiverId, roomCode],
  );
  return result.affectedRows === 1;
}
