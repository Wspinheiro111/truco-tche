import { io } from "socket.io-client";

const baseUrl = process.env.PRIMARY_URL || "http://localhost:3000";
const runId = Date.now();
async function trpc(path, input) { const response = await fetch(`${baseUrl}/api/trpc/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: input }) }); const raw = await response.json(); const cookies = (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean)).map(value => value.split(";")[0]).join("; "); return { data: raw.result?.data?.json ?? raw.result?.data, cookie: cookies }; }
function waitFor(socket, event) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Timeout ${event}`)), 8000); socket.once(event, data => { clearTimeout(timer); resolve(data); }); }); }
async function connectAndAuth(user, cookie) { const socket = io(baseUrl, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"] }); await waitFor(socket, "connect"); const auth = await new Promise(resolve => socket.emit("auth", { userId: user.id, userName: user.name }, resolve)); if (!auth?.success) throw new Error("Auth falhou"); return socket; }

const hostReg = await trpc("localAuth.register", { name: `Atomic Host ${runId}`, email: `atomic-host-${runId}@test.local`, pin: "111111", city: "Porto Alegre", state: "RS" });
const guestAReg = await trpc("localAuth.register", { name: `Atomic Guest A ${runId}`, email: `atomic-a-${runId}@test.local`, pin: "222222", city: "Caxias do Sul", state: "RS" });
const guestBReg = await trpc("localAuth.register", { name: `Atomic Guest B ${runId}`, email: `atomic-b-${runId}@test.local`, pin: "333333", city: "Pelotas", state: "RS" });
const host = await connectAndAuth(hostReg.data.user, hostReg.cookie);
const guestA = await connectAndAuth(guestAReg.data.user, guestAReg.cookie);
const guestB = await connectAndAuth(guestBReg.data.user, guestBReg.cookie);
try {
  const room = await new Promise(resolve => host.emit("create_room", { mode: "1v1", stakeTier: "amistoso", region: "43" }, resolve));
  const [a, b] = await Promise.all([
    new Promise(resolve => guestA.emit("join_room", { code: room.code }, resolve)),
    new Promise(resolve => guestB.emit("join_room", { code: room.code }, resolve)),
  ]);
  const joined = [a, b].filter(result => result?.success).length;
  const rejected = [a, b].filter(result => result?.error).length;
  if (joined !== 1 || rejected !== 1) throw new Error("Reserva atômica permitiu mais de um convidado");
  console.log(JSON.stringify({ ok: true, roomCode: room.code, joined, rejected }));
} finally { host.disconnect(); guestA.disconnect(); guestB.disconnect(); }
