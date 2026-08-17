import { io } from "socket.io-client";
import mysql from "mysql2/promise";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const runId = Date.now();
let hostSocket;
let guestSocket;
let roomCode;
let hostUserId;
let guestUserId;

async function trpc(path, input) {
  const response = await fetch(`${baseUrl}/api/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const raw = await response.json();
  const cookie = (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean))
    .map(value => value.split(";")[0])
    .join("; ");
  return { data: raw.result?.data?.json ?? raw.result?.data, cookie };
}

function waitFor(socket, event, timeoutMs = 5500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${event}`)), timeoutMs);
    socket.once(event, data => { clearTimeout(timer); resolve(data); });
  });
}

async function connectAndAuth(user, cookie) {
  const socket = io(baseUrl, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"] });
  await waitFor(socket, "connect");
  const auth = await new Promise(resolve => socket.emit("auth", { userId: user.id, userName: user.name }, resolve));
  if (!auth?.success) throw new Error(`Autenticação falhou: ${auth?.error || "erro desconhecido"}`);
  return socket;
}

async function cleanup() {
  if (!process.env.DATABASE_URL) return;
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: {} });
  try {
    if (roomCode) {
      await connection.execute("DELETE FROM `inPersonTables` WHERE `roomCode` = ?", [roomCode]);
      await connection.execute("DELETE FROM `activeOnlineGames` WHERE `roomCode` = ?", [roomCode]);
      await connection.execute("DELETE FROM `onlineRooms` WHERE `code` = ?", [roomCode]);
    }
    const ids = [hostUserId, guestUserId].filter(Boolean);
    if (ids.length) {
      await connection.query("DELETE FROM `userNotifications` WHERE `userId` IN (?)", [ids]);
      await connection.query("DELETE FROM `users` WHERE `id` IN (?)", [ids]);
    }
  } finally {
    await connection.end();
  }
}

try {
  const hostRegistration = await trpc("localAuth.register", { name: `Mesa Host ${runId}`, email: `mesa-host-${runId}@test.local`, pin: "111111", city: "Porto Alegre", state: "RS" });
  const guestRegistration = await trpc("localAuth.register", { name: `Mesa Guest ${runId}`, email: `mesa-guest-${runId}@test.local`, pin: "222222", city: "Caxias do Sul", state: "RS" });
  hostUserId = hostRegistration.data.user.id;
  guestUserId = guestRegistration.data.user.id;
  hostSocket = await connectAndAuth(hostRegistration.data.user, hostRegistration.cookie);
  guestSocket = await connectAndAuth(guestRegistration.data.user, guestRegistration.cookie);

  const table = await new Promise(resolve => hostSocket.emit("create_in_person_table", {}, resolve));
  if (!table?.success || !table.inviteToken) throw new Error(`Criação de Mesa Presencial falhou: ${table?.error || "erro desconhecido"}`);
  roomCode = table.code;

  const rejected = await new Promise(resolve => guestSocket.emit("join_room", { code: roomCode, inPersonToken: "token-invalido-comprido-demais" }, resolve));
  if (!rejected?.error) throw new Error("Convite QR inválido foi aceito indevidamente");

  const hostStarted = waitFor(hostSocket, "game_started");
  const guestStarted = waitFor(guestSocket, "game_started");
  const joined = await new Promise(resolve => guestSocket.emit("join_room", { code: roomCode, inPersonToken: table.inviteToken }, resolve));
  if (!joined?.success) throw new Error(`Entrada por QR falhou: ${joined?.error || "erro desconhecido"}`);
  await Promise.all([hostStarted, guestStarted]);

  console.log(JSON.stringify({ ok: true, roomCode, invalidInviteRejected: true, authorizedGuestJoined: true, gameStarted: true }));
} finally {
  hostSocket?.disconnect();
  guestSocket?.disconnect();
  await cleanup();
}

process.exit(0);
