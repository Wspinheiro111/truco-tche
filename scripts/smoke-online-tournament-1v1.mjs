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
    .map((value) => value.split(";")[0])
    .join("; ");
  return { data: raw.result?.data?.json ?? raw.result?.data, cookie };
}

function waitFor(socket, event, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${event}`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

async function connectAndAuth(user, cookie) {
  const socket = io(baseUrl, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"] });
  await waitFor(socket, "connect");
  const auth = await new Promise((resolve) => socket.emit("auth", { userId: user.id, userName: user.name }, resolve));
  if (!auth?.success) throw new Error(`Autenticação falhou: ${auth?.error || "erro desconhecido"}`);
  return socket;
}

const registrations = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
  const pin = `${index + 1}`.repeat(6);
  return trpc("localAuth.register", {
    name: `Torneio ${index + 1} ${runId}`,
    email: `tournament-${runId}-${index + 1}@test.local`,
    pin,
    city: "Porto Alegre",
    state: "RS",
  });
}));
const sockets = await Promise.all(registrations.map((registration) => connectAndAuth(registration.data.user, registration.cookie)));

try {
  const created = await new Promise((resolve) => sockets[0].emit("create_tournament", {
    name: `Smoke 1x1 ${runId}`,
    maxPlayers: 4,
    prize: "Troféu de teste",
  }, resolve));
  if (!created?.tournamentId) throw new Error(`Criação falhou: ${created?.error || "erro desconhecido"}`);

  const readyToStart = waitFor(sockets[0], "tournament_ready_to_start");
  for (const socket of sockets.slice(1)) {
    const joined = await new Promise((resolve) => socket.emit("join_tournament", { tournamentId: created.tournamentId }, resolve));
    if (!joined?.ok) throw new Error(`Inscrição falhou: ${joined?.error || "erro desconhecido"}`);
  }

  await readyToStart;
  let startedPrematurely = false;
  const prematureListener = () => { startedPrematurely = true; };
  sockets.forEach((socket) => socket.once("tournament_match_ready", prematureListener));
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (startedPrematurely) throw new Error("A chave iniciou antes da confirmação manual do organizador");

  const matchReady = sockets.map((socket) => waitFor(socket, "tournament_match_ready"));
  const started = await new Promise((resolve) => sockets[0].emit("start_tournament", { tournamentId: created.tournamentId }, resolve));
  if (!started?.ok) throw new Error(`Início manual falhou: ${started?.error || "erro desconhecido"}`);

  const assignments = await Promise.all(matchReady);
  const distinctPlayers = new Set(assignments.map((assignment) => assignment.roomCode));
  if (distinctPlayers.size !== 2) throw new Error("O sorteio não gerou duas mesas privadas distintas");
  if (assignments.some((assignment) => !assignment.opponentName || !assignment.roomCode)) {
    throw new Error("Um jogador não recebeu confronto e adversário");
  }

  const hosts = assignments.map((assignment, index) => ({ assignment, socket: sockets[index] })).filter(({ assignment }) => assignment.role === "host");
  const guests = assignments.map((assignment, index) => ({ assignment, socket: sockets[index] })).filter(({ assignment }) => assignment.role === "guest");
  if (hosts.length !== 2 || guests.length !== 2) throw new Error("Papéis da chave 1×1 incompletos");

  const gamesStarted = guests.map(({ socket }) => waitFor(socket, "game_started"));
  for (const { assignment, socket } of guests) {
    const joined = await new Promise((resolve) => socket.emit("join_room", { code: assignment.roomCode }, resolve));
    if (!joined?.success) throw new Error(`Convidado não entrou na mesa ${assignment.roomCode}: ${joined?.error || "erro desconhecido"}`);
  }
  await Promise.all(gamesStarted);
  for (const { assignment, socket } of hosts) {
    const recovered = await new Promise((resolve) => socket.emit("recover_waiting_room", { code: assignment.roomCode }, resolve));
    if (!recovered?.found || !recovered?.started) throw new Error(`Anfitrião não recuperou a mesa iniciada ${assignment.roomCode}`);
    const reconnected = await new Promise((resolve) => socket.emit("reconnect_game", {}, resolve));
    if (!reconnected?.success) throw new Error(`Anfitrião não recuperou o snapshot ${assignment.roomCode}`);
  }

  console.log(JSON.stringify({
    ok: true,
    runId,
    tournamentId: created.tournamentId,
    userIds: registrations.map((registration) => registration.data.user.id),
    roomCodes: [...distinctPlayers],
    format: "1v1",
    tournamentStarted: true,
    manualConfirmationRequired: true,
    hostRecoveredAfterGuestStarted: true,
  }));
} finally {
  sockets.forEach((socket) => socket.disconnect());
}
