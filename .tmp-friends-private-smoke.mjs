import { io } from "socket.io-client";

const base = "http://localhost:3000";
const token = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

async function rpc(path, input, cookie = "") {
  const res = await fetch(`${base}/api/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.json?.message || "RPC error");
  return { data: json.result?.data?.json ?? json.result?.data, cookie: res.headers.getSetCookie?.()[0]?.split(";")[0] || "" };
}

async function register(label) {
  const result = await rpc("localAuth.register", { name: `Amigo Smoke ${label} ${token}`, email: `amigo-${label}-${token}@example.test`, pin: "123456", state: "RS", city: "Porto Alegre" });
  return { ...result.data.user, cookie: result.cookie };
}

function connect(user) {
  return new Promise((resolve, reject) => {
    const socket = io(base, { path: "/api/socketio", transports: ["websocket"], extraHeaders: { cookie: user.cookie } });
    socket.once("connect", () => socket.emit("auth", { userId: user.id, userName: user.name }, (reply) => reply?.success ? resolve(socket) : reject(new Error(reply?.error || "socket auth"))));
    socket.once("connect_error", reject);
  });
}

const [sender, receiver, intruder] = await Promise.all([register("A"), register("B"), register("C")]);
await rpc("friends.sendRequest", { userId: receiver.id }, sender.cookie);
const overview = await (async () => {
  const res = await fetch(`${base}/api/trpc/friends.overview`, { headers: { cookie: receiver.cookie } });
  const json = await res.json();
  return json.result?.data?.json ?? json.result?.data;
})();
await rpc("friends.respond", { friendshipId: overview.incoming[0].id, accept: true }, receiver.cookie);

const [s1, s2, s3] = await Promise.all([connect(sender), connect(receiver), connect(intruder)]);
let invite;
const gotInvite = new Promise((resolve) => s2.once("friend_game_invite", resolve));
const room = await new Promise((resolve) => s1.emit("create_room", { mode: "1v1", stakeTier: "amistoso", region: "40", privateInviteeId: receiver.id }, resolve));
invite = await Promise.race([gotInvite, new Promise((_, reject) => setTimeout(() => reject(new Error("invite timeout")), 5000))]);
const blocked = await new Promise((resolve) => s3.emit("join_room", { code: room.code }, resolve));
if (!blocked?.error) throw new Error("intruder was not blocked from private room");
await rpc("friends.claimInvite", { roomCode: room.code }, receiver.cookie);
const gameStarted = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("private game did not start")), 5000);
  s2.once("game_started", (state) => { clearTimeout(timeout); resolve(state); });
});
const joined = await new Promise((resolve) => s2.emit("join_room", { code: room.code }, resolve));
if (!joined?.success || invite.roomCode !== room.code) throw new Error("friend could not join invited private room");
await gameStarted;
console.log(JSON.stringify({ ok: true, users: [sender.id, receiver.id, intruder.id], roomCode: room.code }));
s1.disconnect(); s2.disconnect(); s3.disconnect();
