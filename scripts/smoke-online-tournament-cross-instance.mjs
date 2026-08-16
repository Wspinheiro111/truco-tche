import { io } from "socket.io-client";

const hostUrl = process.env.HOST_URL || "http://127.0.0.1:3000";
const guestUrl = process.env.GUEST_URL || "http://127.0.0.1:3106";
const runId = Date.now();

async function trpc(path, input) {
  const response = await fetch(`${hostUrl}/api/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const raw = await response.json();
  const cookie = (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean))
    .map((value) => value.split(";")[0]).join("; ");
  return { data: raw.result?.data?.json ?? raw.result?.data, cookie };
}

function waitFor(socket, event, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${event}`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

async function connectAndAuth(baseUrl, user, cookie) {
  const socket = io(baseUrl, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"] });
  await waitFor(socket, "connect");
  const auth = await new Promise((resolve) => socket.emit("auth", { userId: user.id, userName: user.name }, resolve));
  if (!auth?.success) throw new Error(`Autenticação em ${baseUrl} falhou: ${auth?.error || "erro desconhecido"}`);
  return socket;
}

async function findTournamentMatch(socket) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await new Promise((resolve) => socket.emit("get_tournament_match", {}, resolve));
    if (result?.found && result.roomCode) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Confronto persistido não apareceu para o participante");
}

const registrations = await Promise.all(Array.from({ length: 4 }, async (_, index) => trpc("localAuth.register", {
  name: `Cross Tournament ${index + 1} ${runId}`,
  email: `cross-tournament-${runId}-${index + 1}@test.local`,
  pin: `${index + 1}`.repeat(6),
  city: "Porto Alegre",
  state: "RS",
})));
const instanceUrls = [hostUrl, hostUrl, guestUrl, guestUrl];
const sockets = await Promise.all(registrations.map((registration, index) => connectAndAuth(instanceUrls[index], registration.data.user, registration.cookie)));

try {
  const created = await new Promise((resolve) => sockets[0].emit("create_tournament", {
    name: `Cross 1x1 ${runId}`,
    maxPlayers: 4,
  }, resolve));
  if (!created?.tournamentId) throw new Error(`Criação falhou: ${created?.error || "erro desconhecido"}`);
  for (const socket of sockets.slice(1)) {
    const joined = await new Promise((resolve) => socket.emit("join_tournament", { tournamentId: created.tournamentId }, resolve));
    if (!joined?.ok) throw new Error(`Inscrição falhou: ${joined?.error || "erro desconhecido"}`);
  }

  const assignments = await Promise.all(sockets.map(findTournamentMatch));
  const hosts = assignments.map((assignment, index) => ({ assignment, socket: sockets[index] })).filter(({ assignment }) => assignment.role === "host");
  const guests = assignments.map((assignment, index) => ({ assignment, socket: sockets[index] })).filter(({ assignment }) => assignment.role === "guest");
  if (hosts.length !== 2 || guests.length !== 2) throw new Error("Papéis de confronto inválidos");

  for (const { assignment, socket } of guests) {
    const joined = await new Promise((resolve) => socket.emit("join_room", { code: assignment.roomCode }, resolve));
    if (!joined?.success) throw new Error(`Convidado não iniciou ${assignment.roomCode}: ${joined?.error || "erro desconhecido"}`);
  }
  for (const { assignment, socket } of hosts) {
    const afterGuest = await findTournamentMatch(socket);
    if (afterGuest.status !== "playing") throw new Error(`Confronto ${assignment.roomCode} não iniciou após entrada do convidado`);
    const recovered = await new Promise((resolve) => socket.emit("recover_waiting_room", { code: assignment.roomCode }, resolve));
    if (!recovered?.found || !recovered?.started) throw new Error(`Anfitrião não recuperou a mesa já iniciada ${assignment.roomCode}`);
    // O início autoritativo persiste a mão após a breve animação de abertura.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const reconnected = await new Promise((resolve) => socket.emit("reconnect_game", {}, resolve));
    if (!reconnected?.success) throw new Error(`Snapshot não restaurado para ${assignment.roomCode}`);
  }

  console.log(JSON.stringify({
    ok: true,
    runId,
    tournamentId: created.tournamentId,
    userIds: registrations.map((registration) => registration.data.user.id),
    roomCodes: [...new Set(assignments.map((assignment) => assignment.roomCode))],
    crossInstanceRecovery: true,
  }));
} finally {
  sockets.forEach((socket) => socket.disconnect());
}
