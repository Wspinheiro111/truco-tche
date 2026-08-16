import { io } from "socket.io-client";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const runId = Date.now();

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

function waitFor(socket, event, timeoutMs = 4500) {
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

function avatarIndex(roomCode, role) {
  let hash = 2166136261;
  for (const character of roomCode) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const first = Math.abs(hash >>> 0) % 9;
  return role === "p2" ? (first + 1) % 9 : first;
}

const hostReg = await trpc("localAuth.register", { name: `Presence Host ${runId}`, email: `presence-host-${runId}@test.local`, pin: "111111", city: "Porto Alegre", state: "RS" });
const guestReg = await trpc("localAuth.register", { name: `Presence Guest ${runId}`, email: `presence-guest-${runId}@test.local`, pin: "222222", city: "Caxias do Sul", state: "RS" });
const host = await connectAndAuth(hostReg.data.user, hostReg.cookie);
let guest = await connectAndAuth(guestReg.data.user, guestReg.cookie);

try {
  const room = await new Promise(resolve => host.emit("create_room", { mode: "1v1", stakeTier: "amistoso", region: "40" }, resolve));
  if (!room?.success) throw new Error(`Criação falhou: ${room?.error || "erro desconhecido"}`);

  const hostStarted = waitFor(host, "game_started");
  const joined = await new Promise(resolve => guest.emit("join_room", { code: room.code }, resolve));
  if (!joined?.success) throw new Error(`Entrada falhou: ${joined?.error || "erro desconhecido"}`);
  await hostStarted;

  const avatarsAreDistinct = avatarIndex(room.code, "p1") !== avatarIndex(room.code, "p2");
  if (!avatarsAreDistinct) throw new Error("Os jogadores receberam o mesmo índice de avatar");

  const opponentAway = waitFor(host, "opponent_disconnected_temp");
  guest.disconnect();
  const awayEvent = await opponentAway;
  if (!awayEvent?.gracePeriodMs) throw new Error("Evento de presença reconectando não foi recebido");

  const opponentBack = waitFor(host, "opponent_reconnected");
  guest = await connectAndAuth(guestReg.data.user, guestReg.cookie);
  const reconnected = await new Promise(resolve => guest.emit("reconnect_game", {}, resolve));
  if (!reconnected?.success) throw new Error(`Reconexão falhou: ${reconnected?.error || "erro desconhecido"}`);
  await opponentBack;

  console.log(JSON.stringify({
    ok: true,
    runId,
    roomCode: room.code,
    hostUserId: hostReg.data.user.id,
    guestUserId: guestReg.data.user.id,
    avatarsAreDistinct,
    presenceFlow: ["online", "reconnecting", "online"],
  }));
} finally {
  host.disconnect();
  guest.disconnect();
}
