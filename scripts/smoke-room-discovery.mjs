import { io } from "socket.io-client";

const baseUrl = process.env.PRIMARY_URL || "http://localhost:3000";
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

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${event}`)), 8000);
    socket.once(event, data => { clearTimeout(timer); resolve(data); });
  });
}

async function connectAndAuth(user, cookie) {
  const socket = io(baseUrl, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"] });
  await waitFor(socket, "connect");
  const auth = await new Promise(resolve => socket.emit("auth", { userId: user.id, userName: user.name }, resolve));
  if (!auth?.success) throw new Error(`Autenticação Socket.IO falhou: ${auth?.error || "erro desconhecido"}`);
  return socket;
}

const hostReg = await trpc("localAuth.register", {
  name: `Discovery Host ${runId}`,
  email: `discovery-host-${runId}@test.local`,
  pin: "111111",
  city: "Porto Alegre",
  state: "RS",
});
const guestReg = await trpc("localAuth.register", {
  name: `Discovery Guest ${runId}`,
  email: `discovery-guest-${runId}@test.local`,
  pin: "222222",
  city: "Caxias do Sul",
  state: "RS",
});

const host = await connectAndAuth(hostReg.data.user, hostReg.cookie);
const guest = await connectAndAuth(guestReg.data.user, guestReg.cookie);

try {
  const invalidated = waitFor(guest, "rooms_invalidated");
  const room = await new Promise(resolve => host.emit("create_room", { mode: "1v1", stakeTier: "amistoso", region: "40" }, resolve));
  if (!room?.success) throw new Error(`Criação de sala falhou: ${room?.error || "erro desconhecido"}`);

  await invalidated;
  const listing = await new Promise(resolve => guest.emit("list_rooms", { mode: "all", stakeTier: "all", region: "all" }, resolve));
  const discovered = (listing?.rooms || []).find(candidate => candidate.code === room.code);
  if (!discovered) throw new Error("O segundo cliente não encontrou a sala persistida do primeiro cliente");

  const hostStarted = waitFor(host, "game_started");
  const guestStarted = waitFor(guest, "game_started");
  const joined = await new Promise(resolve => guest.emit("join_room", { code: room.code }, resolve));
  if (!joined?.success) throw new Error(`O segundo cliente não entrou na sala descoberta: ${joined?.error || "erro desconhecido"}`);
  await Promise.all([hostStarted, guestStarted]);

  console.log(JSON.stringify({
    ok: true,
    runId,
    roomCode: room.code,
    hostUserId: hostReg.data.user.id,
    guestUserId: guestReg.data.user.id,
    discoveredHost: discovered.hostName,
    joined: true,
    gameStarted: true,
  }));

  await new Promise(resolve => host.emit("cancel_room", {}, resolve));
} finally {
  host.disconnect();
  guest.disconnect();
}
