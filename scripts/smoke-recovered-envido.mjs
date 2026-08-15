import { io } from "socket.io-client";

const primaryUrl = process.env.PRIMARY_URL || "http://localhost:3000";
const secondaryUrl = process.env.SECONDARY_URL || "http://localhost:3001";
const runId = Date.now();
async function trpc(path, input) { const response = await fetch(`${primaryUrl}/api/trpc/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: input }) }); const raw = await response.json(); const cookies = (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean)).map(value => value.split(";")[0]).join("; "); return { data: raw.result?.data?.json ?? raw.result?.data, cookie: cookies }; }
function waitFor(socket, event, timeoutMs = 8000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Timeout ${event}`)), timeoutMs); socket.once(event, data => { clearTimeout(timer); resolve(data); }); }); }
async function connectAndAuth(url, user, cookie) { const socket = io(url, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"] }); await waitFor(socket, "connect"); const auth = await new Promise(resolve => socket.emit("auth", { userId: user.id, userName: user.name }, resolve)); if (!auth?.success) throw new Error(`Auth falhou em ${url}`); return socket; }

const hostReg = await trpc("localAuth.register", { name: `Envido Host ${runId}`, email: `envido-host-${runId}@test.local`, pin: "111111", city: "Porto Alegre", state: "RS" });
const guestReg = await trpc("localAuth.register", { name: `Envido Guest ${runId}`, email: `envido-guest-${runId}@test.local`, pin: "222222", city: "Caxias do Sul", state: "RS" });
const hostA = await connectAndAuth(primaryUrl, hostReg.data.user, hostReg.cookie);
const guestA = await connectAndAuth(primaryUrl, guestReg.data.user, guestReg.cookie);
let guestB;
try {
  const room = await new Promise(resolve => hostA.emit("create_room", { mode: "1v1", stakeTier: "amistoso", region: "43" }, resolve));
  const initial = waitFor(hostA, "game_state");
  const joined = await new Promise(resolve => guestA.emit("join_room", { code: room.code }, resolve));
  const state = await initial;
  if (!joined?.success || !state?.canEnvido) throw new Error("Rodada não habilitou Envido para o teste");
  const pending = waitFor(guestA, "envido_called");
  const called = await new Promise(resolve => hostA.emit("call_envido", { action: "envido" }, resolve));
  await pending;
  if (!called?.ok) throw new Error("Chamada de Envido falhou");
  guestB = await connectAndAuth(secondaryUrl, guestReg.data.user, guestReg.cookie);
  const restored = waitFor(guestB, "game_state");
  const recovered = await new Promise(resolve => guestB.emit("reconnect_game", {}, resolve));
  const recoveredState = await restored;
  if (!recovered?.success || recoveredState?.phase !== "envido_neg" || recoveredState?.myRole !== "p2" || recoveredState?.turn !== "p2") throw new Error("Envido pendente não foi recuperado ao respondente");
  console.log(JSON.stringify({ ok: true, roomCode: room.code, phase: recoveredState.phase, responder: recoveredState.myRole }));
} finally { hostA.disconnect(); guestA.disconnect(); guestB?.disconnect(); }
