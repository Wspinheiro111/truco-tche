import { io } from "socket.io-client";

const primaryUrl = process.env.PRIMARY_URL || "http://localhost:3000";
const secondaryUrl = process.env.SECONDARY_URL || "http://localhost:3001";
const runId = Date.now();

async function trpc(path, input) {
  const response = await fetch(`${primaryUrl}/api/trpc/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: input }) });
  const raw = await response.json();
  const cookies = (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean)).map(value => value.split(";")[0]).join("; ");
  return { data: raw.result?.data?.json ?? raw.result?.data, cookie: cookies };
}
function waitFor(socket, event, timeoutMs = 8000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Timeout ${event}`)), timeoutMs); socket.once(event, data => { clearTimeout(timer); resolve(data); }); }); }
async function connectAndAuth(url, user, cookie) {
  const socket = io(url, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"] });
  await waitFor(socket, "connect");
  const auth = await new Promise(resolve => socket.emit("auth", { userId: user.id, userName: user.name }, resolve));
  if (!auth?.success) throw new Error(`Auth falhou em ${url}`);
  return socket;
}

const hostReg = await trpc("localAuth.register", { name: `Dual Host ${runId}`, email: `dual-host-${runId}@test.local`, pin: "111111", city: "Porto Alegre", state: "RS" });
const guestReg = await trpc("localAuth.register", { name: `Dual Guest ${runId}`, email: `dual-guest-${runId}@test.local`, pin: "222222", city: "Caxias do Sul", state: "RS" });
const hostA = await connectAndAuth(primaryUrl, hostReg.data.user, hostReg.cookie);
const guestA = await connectAndAuth(primaryUrl, guestReg.data.user, guestReg.cookie);
let hostB;
try {
  const room = await new Promise(resolve => hostA.emit("create_room", { mode: "1v1", stakeTier: "amistoso", region: "43" }, resolve));
  const started = waitFor(hostA, "game_state");
  const joined = await new Promise(resolve => guestA.emit("join_room", { code: room.code }, resolve));
  await started;
  if (!joined?.success) throw new Error("Entrada na sala falhou");

  hostB = await connectAndAuth(secondaryUrl, hostReg.data.user, hostReg.cookie);
  const recovered = await new Promise(resolve => hostB.emit("reconnect_game", {}, resolve));
  if (!recovered?.success) throw new Error("Segunda instância não recuperou a partida");

  const [primaryResult, secondaryResult] = await Promise.all([
    new Promise(resolve => hostA.emit("call_truco", {}, resolve)),
    new Promise(resolve => hostB.emit("call_truco", {}, resolve)),
  ]);
  const applied = [primaryResult, secondaryResult].filter(result => result?.ok).length;
  const conflicted = [primaryResult, secondaryResult].filter(result => result?.error).length;
  if (applied !== 1 || conflicted !== 1) throw new Error("Conflito entre instâncias não foi resolvido por versão");
  console.log(JSON.stringify({ ok: true, roomCode: room.code, applied, conflicted }));
} finally {
  hostA.disconnect();
  guestA.disconnect();
  hostB?.disconnect();
}
