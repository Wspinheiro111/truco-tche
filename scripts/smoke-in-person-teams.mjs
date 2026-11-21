import { io } from "socket.io-client";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const runId = Date.now();
const createdRooms = [];
const createdUsers = [];
const sockets = [];

async function trpc(path, input) {
  const response = await fetch(`${baseUrl}/api/trpc/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: input }) });
  const raw = await response.json();
  const cookie = (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean)).map(value => value.split(";")[0]).join("; ");
  return { data: raw.result?.data?.json ?? raw.result?.data, cookie };
}

function waitFor(socket, event, timeoutMs = 6500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${event}`)), timeoutMs);
    socket.once(event, data => { clearTimeout(timer); resolve(data); });
  });
}

async function connectAndAuth(user, cookie) {
  const socket = io(baseUrl, { path: "/api/socketio", extraHeaders: { cookie }, transports: ["websocket"], reconnection: false });
  await waitFor(socket, "connect");
  const auth = await new Promise(resolve => socket.emit("auth", { userId: user.id, userName: user.name }, resolve));
  if (!auth?.success) throw new Error(`Autenticação falhou: ${auth?.error || "erro desconhecido"}`);
  sockets.push(socket);
  return socket;
}

async function createUser(label, index) {
  const registration = await trpc("localAuth.register", { name: `${label} ${index} ${runId}`, email: `mesa-${label.toLowerCase()}-${index}-${runId}@test.local`, pin: `11${String(index).padStart(4, "0")}`, city: "Porto Alegre", state: "RS" });
  createdUsers.push(registration.data.user.id);
  return { registration, socket: await connectAndAuth(registration.data.user, registration.cookie) };
}

// Execute com --full-match para testar o servidor até 24 pontos, inclusive
// a retomada do último assento após desconectar e abrir um novo socket.
async function finishMatch(players, mode, code) {
  const states = new Map();
  const results = new Map();
  function observe(socket, role) {
    socket.on("game_state", state => states.set(role, state));
    socket.on("game_over", result => results.set(role, result));
  }
  players.forEach(({ socket }, i) => observe(socket, `p${i + 1}`));

  // A reconexão deve restituir a mão privada do jogador que trocou de socket.
  const last = players.at(-1);
  const role = `p${players.length}`;
  const before = last.lastView;
  last.socket.disconnect();
  last.socket = await connectAndAuth(last.registration.data.user, last.registration.cookie);
  observe(last.socket, role);
  const recovered = await last.socket.timeout(6500).emitWithAck("reconnect_game", {});
  assert.equal(recovered.roomCode, code);
  assert.equal(recovered.role, role);
  const after = states.get(role);
  for (const key of ["myRole", "myHand", "team", "score", "turn", "table", "roundWins"]) {
    assert.deepEqual(after[key], before[key], `${mode}: reconexão alterou ${key}`);
  }

  const deadline = Date.now() + 240_000;
  let moves = 0;
  while (results.size < players.length && Date.now() < deadline) {
    const host = states.get("p1");
    const actor = host && states.get(host.turn);
    if (host?.phase !== "playing" || !actor || actor.phase !== "playing" || actor.turn !== actor.myRole) {
      await new Promise(resolve => setTimeout(resolve, 20));
      continue;
    }
    const socket = players[Number(actor.myRole.slice(1)) - 1].socket;
    const reply = await socket.timeout(6500).emitWithAck("team_play_card", { cardId: actor.myHand[0].id });
    assert.equal(reply.ok, true, reply.error);
    moves++;
  }
  assert.equal(results.size, players.length, `${mode}: jogadores sem resultado final`);
  const final = results.get("p1");
  assert.ok(["A", "B"].includes(final.winner));
  assert.equal(final.score[final.winner], 24);
  for (const result of results.values()) assert.deepEqual(result, final);
  return { reconnectedSeat: role, movesAfterReconnect: moves, winner: final.winner, score: final.score };
}

async function runMode(mode, playerCount) {
  const players = [];
  for (let index = 1; index <= playerCount; index += 1) players.push(await createUser(mode, index));
  const host = players[0];
  const table = await new Promise(resolve => host.socket.emit("create_in_person_table", { mode }, resolve));
  if (!table?.success || table.maxPlayers !== playerCount) throw new Error(`${mode}: criação inválida`);
  createdRooms.push(table.code);
  const hostStarted = waitFor(host.socket, "game_started");
  const guestStarts = players.slice(1).map(player => waitFor(player.socket, "game_started"));
  for (const player of players.slice(1)) {
    const result = await new Promise(resolve => player.socket.emit("join_room", { code: table.code, inPersonToken: table.inviteToken }, resolve));
    if (!result?.success) throw new Error(`${mode}: entrada falhou: ${result?.error || "erro desconhecido"}`);
  }
  await Promise.all([hostStarted, ...guestStarts]);
  const teamStates = await Promise.all(players.map(player => waitFor(player.socket, "game_state")));
  if (!teamStates.every(state => state.isTeamGame && state.mode === mode)) throw new Error(`${mode}: estado de equipe não recebido por todos`);
  const roles = teamStates.map(state => state.myRole);
  if (new Set(roles).size !== playerCount) throw new Error(`${mode}: assentos não são únicos`);
  const roster = teamStates[0].participants.sort((a, b) => a.seat - b.seat);
  const expectedTeams = Array.from({ length: playerCount }, (_, index) => index % 2 === 0 ? "A" : "B");
  if (roster.map(player => player.team).join("") !== expectedTeams.join("")) throw new Error(`${mode}: equipes não alternadas`);
  const lastPlayer = players.at(-1);
  lastPlayer.socket.on("game_state", state => { lastPlayer.lastView = state; });
  const roundResolved = waitFor(host.socket, "round_result");
  for (const state of teamStates.sort((a, b) => Number(a.myRole.slice(1)) - Number(b.myRole.slice(1)))) {
    const playerSocket = players[roles.indexOf(state.myRole)].socket;
    const result = await new Promise(resolve => playerSocket.emit("team_play_card", { cardId: state.myHand[0].id }, resolve));
    if (!result?.ok) throw new Error(`${mode}: carta do ${state.myRole} não foi aceita: ${result?.error || "erro desconhecido"}`);
  }
  const round = await roundResolved;
  if (!round?.teamGame || !["A", "B", "draw"].includes(round.result)) throw new Error(`${mode}: vaza de equipe não foi resolvida`);
  const fullMatch = process.argv.includes("--full-match") ? await finishMatch(players, mode, table.code) : undefined;
  return { fullMatch, mode, roomCode: table.code, playerCount, roles, teams: roster.map(player => player.team), roundResult: round.result };
}

async function cleanup() {
  sockets.forEach(socket => socket.disconnect());
  if (!process.env.DATABASE_URL) return;
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: {} });
  try {
    for (const code of createdRooms) {
      await connection.execute("DELETE FROM `activeOnlineGamePlayers` WHERE `roomCode` = ?", [code]);
      await connection.execute("DELETE FROM `activeOnlineGames` WHERE `roomCode` = ?", [code]);
      await connection.execute("DELETE FROM `inPersonTables` WHERE `roomCode` = ?", [code]);
      await connection.execute("DELETE FROM `onlineRooms` WHERE `code` = ?", [code]);
    }
    if (createdUsers.length) {
      await connection.query("DELETE FROM `userNotifications` WHERE `userId` IN (?)", [createdUsers]);
      await connection.query("DELETE FROM `users` WHERE `id` IN (?)", [createdUsers]);
    }
  } finally { await connection.end(); }
}

try {
  const duplas = await runMode("2v2", 4);
  const trios = await runMode("3v3", 6);
  console.log(JSON.stringify({ ok: true, duplas, trios }));
} finally {
  await cleanup();
}

process.exit(0);
