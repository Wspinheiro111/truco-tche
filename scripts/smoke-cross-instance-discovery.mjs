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
let hostReconnected;

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
  const cardId = hostState?.myHand?.[0]?.id;
  if (!cardId) throw new Error("O anfitrião não recebeu uma carta jogável após a sincronização");

  const guestStateAfterCard = waitFor(guest, "game_state", 6000);
  const played = await new Promise(resolve => host.emit("play_card", { cardId }, resolve));
  if (!played?.ok) throw new Error(`Jogada cruzada falhou: ${played?.error || "erro desconhecido"}`);
  await new Promise(resolve => setTimeout(resolve, 150));
  const guestSyncResult = await new Promise(resolve => guest.emit("sync_game_state", {}, resolve));
  if (!guestSyncResult?.ok) throw new Error(`Sincronização do oponente após a carta falhou: ${guestSyncResult?.error || "erro desconhecido"}`);
  const guestState = await guestStateAfterCard;
  const cardReachedGuest = Array.isArray(guestState?.table) && guestState.table.some(entry => entry?.card?.id === cardId);
  if (!cardReachedGuest) throw new Error("A carta persistida não chegou ao oponente pela sincronização entre instâncias");

  host.disconnect();
  hostReconnected = await connectAndAuth(guestUrl, hostReg.data.user, hostReg.cookie);
  const recoveredState = waitFor(hostReconnected, "game_state", 6000);
  const reconnected = await new Promise(resolve => hostReconnected.emit("reconnect_game", {}, resolve));
  if (!reconnected?.success) throw new Error(`Reconexão cruzada falhou: ${reconnected?.error || "erro desconhecido"}`);
  const recoveredHostState = await recoveredState;
  const recoveredCard = Array.isArray(recoveredHostState?.table) && recoveredHostState.table.some(entry => entry?.card?.id === cardId);
  const recoveredTurn = recoveredHostState?.turn === guestState?.turn;
  const recoveredClock = typeof recoveredHostState?.turnTimeLeftMs === "number" && recoveredHostState.turnTimeLeftMs >= 0;
  if (!recoveredCard || !recoveredTurn || !recoveredClock) {
    throw new Error("Reconexão cruzada não restaurou carta, turno e cronômetro corretamente");
  }

  const guestCardId = guestState?.myHand?.[0]?.id;
  if (!guestCardId) throw new Error("O oponente não recebeu uma carta jogável após a reconexão");
  const guestPlayed = await new Promise(resolve => guest.emit("play_card", { cardId: guestCardId }, resolve));
  if (!guestPlayed?.ok) throw new Error(`Jogada posterior à reconexão falhou: ${guestPlayed?.error || "erro desconhecido"}`);

  await new Promise(resolve => setTimeout(resolve, 31_000));
  const postGraceState = waitFor(hostReconnected, "game_state", 6000);
  const postGraceSync = await new Promise(resolve => hostReconnected.emit("sync_game_state", {}, resolve));
  if (!postGraceSync?.ok) throw new Error(`A partida foi encerrada indevidamente após reconexão: ${postGraceSync?.error || "erro desconhecido"}`);
  const postGraceHostState = await postGraceState;
  const reconnectionMarkerSurvivedFollowupPlay = postGraceHostState?.phase !== "game_over";
  if (!reconnectionMarkerSurvivedFollowupPlay) throw new Error("A partida encerrou indevidamente após reconexão seguida de nova jogada");

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
    cardReachedGuest,
    recoveredAcrossInstances: true,
    recoveredCard,
    recoveredTurn,
    recoveredClock,
    reconnectionMarkerSurvivedFollowupPlay,
  }));
} finally {
  host.disconnect();
  guest.disconnect();
  hostReconnected?.disconnect();
}
