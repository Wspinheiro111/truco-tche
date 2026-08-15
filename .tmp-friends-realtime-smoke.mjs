import { io } from "socket.io-client";

const base = "http://localhost:3000";
const token = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

async function rpc(path, input, cookie = "") {
  const response = await fetch(`${base}/api/trpc/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ json: input }) });
  const json = await response.json();
  if (json.error) throw new Error(json.error.json?.message || "RPC failed");
  return { data: json.result?.data?.json ?? json.result?.data, cookie: response.headers.getSetCookie?.()[0]?.split(";")[0] || "" };
}

async function register(letter) {
  const result = await rpc("localAuth.register", { name: `RealTime ${letter} ${token}`, email: `amigo-${letter}-${token}@example.test`, pin: "123456", state: "RS", city: "Porto Alegre" });
  return { ...result.data.user, cookie: result.cookie };
}

function connect(user) {
  return new Promise((resolve, reject) => {
    const socket = io(base, { path: "/api/socketio", transports: ["websocket"], extraHeaders: { cookie: user.cookie } });
    socket.once("connect", () => socket.emit("auth", { userId: user.id, userName: user.name }, (reply) => reply?.success ? resolve(socket) : reject(new Error(reply?.error || "auth"))));
    socket.once("connect_error", reject);
  });
}

function once(socket, event) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 5000); socket.once(event, data => { clearTimeout(timer); resolve(data); }); }); }

const [sender, receiver, intruder] = await Promise.all([register("A"), register("B"), register("C")]);
const [s1, s2, s3] = await Promise.all([connect(sender), connect(receiver), connect(intruder)]);
const requested = once(s2, "friendship_updated");
await rpc("friends.sendRequest", { userId: receiver.id }, sender.cookie);
s1.emit("friendship_event", { targetUserId: receiver.id, kind: "request" });
if ((await requested).kind !== "request") throw new Error("friend request notification missing");
const overviewResponse = await fetch(`${base}/api/trpc/friends.overview`, { headers: { cookie: receiver.cookie } });
const overviewJson = await overviewResponse.json();
const overview = overviewJson.result?.data?.json ?? overviewJson.result?.data;
const accepted = once(s1, "friendship_updated");
await rpc("friends.respond", { friendshipId: overview.incoming[0].id, accept: true }, receiver.cookie);
s2.emit("friendship_event", { targetUserId: sender.id, kind: "accepted" });
if ((await accepted).kind !== "accepted") throw new Error("friend acceptance notification missing");
const inviteReceived = once(s2, "friend_game_invite");
const room = await new Promise(resolve => s1.emit("create_room", { mode: "1v1", stakeTier: "amistoso", region: "40", privateInviteeId: receiver.id }, resolve));
const invite = await inviteReceived;
const blocked = await new Promise(resolve => s3.emit("join_room", { code: room.code }, resolve));
if (!blocked?.error) throw new Error("private room allowed intruder");
const started = once(s2, "game_started");
const joined = await new Promise(resolve => s2.emit("join_room", { code: room.code }, resolve));
if (!joined?.success || invite.roomCode !== room.code) throw new Error("invited friend could not join");
await started;
console.log(JSON.stringify({ ok: true, users: [sender.id, receiver.id, intruder.id], roomCode: room.code }));
s1.disconnect(); s2.disconnect(); s3.disconnect();
