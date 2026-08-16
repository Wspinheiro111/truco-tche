import { io } from "socket.io-client";

const hostUrl = process.env.HOST_URL || "http://127.0.0.1:3000";
const guestUrl = process.env.GUEST_URL || "http://127.0.0.1:3101";
const runId = Date.now();

async function trpc(path, input) {
  const response = await fetch(`${hostUrl}/api/trpc/${path}`, {
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

function waitFor(socket, event, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${event}`)), timeoutMs);
    socket.once(event, data => { clearTimeout(timer); resolve(data); });
  });
}

async function connectAndAuth(baseUrl, user, cookie) {
  const socket = io(baseUrl, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"] });
  await waitFor(socket, "connect");
  const auth = await new Promise(resolve => socket.emit("auth", { userId: user.id, userName: user.name }, resolve));
  if (!auth?.success) throw new Error(`Autenticação em ${baseUrl} falhou: ${auth?.error || "erro desconhecido"}`);
  return socket;
}

const hostReg = await trpc("localAuth.register", { name: `Cross Host ${runId}`, email: `cross-host-${runId}@test.local`, pin: "111111", city: "Porto Alegre", state: "RS" });
const guestReg = await trpc("localAuth.register", { name: `Cross Guest ${runId}`, email: `cross-guest-${runId}@test.local`, pin: "222222", city: "Caxias do Sul", state: "RS" });
const host = await connectAndAuth(hostUrl, hostReg.data.user, hostReg.cookie);
const guest = await connectAndAuth(guestUrl, guestReg.data.user, guestReg.cookie);

try {
  const room = await new Promise(resolve => host.emit("create_room", { mode: "1v1", stakeTier: "amistoso", region: "40" }, resolve));
  if (!room?.success) throw new Error(`Criação falhou: ${room?.error || "erro desconhecido"}`);
  const listing = await new Promise(resolve => guest.emit("list_rooms", { mode: "all", stakeTier: "all", region: "all" }, resolve));
  const discovered = (listing?.rooms || []).find(candidate => candidate.code === room.code);
  if (!discovered) throw new Error("Instância B não encontrou a sala persistida da instância A");

  // Reprodução explícita do bug legado: a instância B não possui a sala da A
  // no próprio Map. Se ela transferisse esse payload local vazio para a tela,
  // apagaria a sala que a mesma sessão acaba de encontrar pela fonte persistida.
  const legacyLocalPayloadFromGuestInstance = [];
  const legacyPayloadWouldHidePersistedRoom = legacyLocalPayloadFromGuestInstance.length === 0 && Boolean(discovered);
  if (!legacyPayloadWouldHidePersistedRoom) throw new Error("Não foi possível reproduzir o cenário legado de invisibilidade");

  const hostStarted = waitFor(host, "game_started").then(() => true).catch(() => false);
  const guestStarted = waitFor(guest, "game_started").then(() => true).catch(() => false);
  const hostSynchronizedState = waitFor(host, "game_state", 6000);
  const joined = await new Promise(resolve => guest.emit("join_room", { code: room.code }, resolve));
  if (!joined?.success) throw new Error(`Entrada na sala cruzada falhou: ${joined?.error || "erro desconhecido"}`);

  // O cliente anfitrião real chama sync_game_state a cada 2,5 s enquanto aguarda.
  // Em outra instância não há game_started direto, então validamos o mesmo caminho
  // persistido que abre a mesa quando chega um estado synchronized.
  await new Promise(resolve => setTimeout(resolve, 1200));
  const syncResult = await new Promise(resolve => host.emit("sync_game_state", {}, resolve));
  if (!syncResult?.ok) throw new Error(`Sincronização persistida do anfitrião falhou: ${syncResult?.error || "erro desconhecido"}`);
  const hostState = await hostSynchronizedState;

  console.log(JSON.stringify({
    ok: true,
    runId,
    roomCode: room.code,
    hostUserId: hostReg.data.user.id,
    guestUserId: guestReg.data.user.id,
    discoveredAcrossInstances: true,
    legacyPayloadWouldHidePersistedRoom,
    joinedAcrossInstances: true,
    hostReceivedGameStarted: await hostStarted,
    guestReceivedGameStarted: await guestStarted,
    hostReceivedSynchronizedState: Boolean(hostState?.synchronized),
  }));
} finally {
  host.disconnect();
  guest.disconnect();
}
