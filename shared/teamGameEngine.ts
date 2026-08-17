import {
  type Card,
  calcEnvido,
  getEnvidoBet,
  getEnvidoRefusalPoints,
  getFlorBet,
  getFlorRefusalPoints,
  makeDeckSeeded,
  TRUCO_POINTS,
  TURN_TIMEOUT_MS,
} from "./gameEngine";

export type Team = "A" | "B";
export type TeamPlayer = "p1" | "p2" | "p3" | "p4" | "p5" | "p6";
export type TeamMode = "2v2" | "3v3";
export type TeamPhase = "waiting" | "playing" | "truco_neg" | "envido_neg" | "flor_neg" | "game_over" | "between_hands";
export type TeamRoundResult = Team | "draw";

export type TeamTableEntry = { card: Card; player: TeamPlayer; team: Team };
export type TeamPlayResult = {
  state: TeamGameState;
  completedTrick?: TeamTableEntry[];
  roundResult?: TeamRoundResult;
  handWinner?: Team;
  gameWinner?: Team;
};

export interface TeamGameState {
  kind: "team";
  mode: TeamMode;
  teamSize: 2 | 3;
  playerOrder: TeamPlayer[];
  teams: Record<TeamPlayer, Team>;
  phase: TeamPhase;
  turn: TeamPlayer;
  mano: TeamPlayer;
  handMano: TeamPlayer;
  score: Record<Team, number>;
  target: number;
  hands: Record<TeamPlayer, Card[]>;
  table: TeamTableEntry[];
  roundWins: TeamRoundResult[];
  trucoLevel: number;
  trucoCaller: TeamPlayer | null;
  lastTrucoCaller: TeamPlayer | null;
  envidoChain: string[];
  envidoBet: number;
  envidoCaller: TeamPlayer | null;
  envidoResolved: boolean;
  envidoPoints: Record<TeamPlayer, number>;
  hasFlor: Record<TeamPlayer, boolean>;
  florChain: string[];
  florBet: number;
  florCaller: TeamPlayer | null;
  playedFirst: Record<TeamPlayer, boolean>;
  winner: Team | null;
  seed: number;
  vira: Card | null;
  turnStartedAt: number;
  turnTimeoutMs: number;
}

export function getTeamModeConfig(mode: TeamMode) {
  return { teamSize: mode === "2v2" ? 2 : 3, playerCount: mode === "2v2" ? 4 : 6, target: 24 } as const;
}

export function teamForSeat(seat: number): Team {
  return seat % 2 === 1 ? "A" : "B";
}

function slotsFor(mode: TeamMode): TeamPlayer[] {
  const count = getTeamModeConfig(mode).playerCount;
  return Array.from({ length: count }, (_, index) => `p${index + 1}` as TeamPlayer);
}

function emptyRecord<T>(slots: TeamPlayer[], value: T): Record<TeamPlayer, T> {
  return Object.fromEntries(slots.map(slot => [slot, value])) as Record<TeamPlayer, T>;
}

function nextPlayer(state: TeamGameState, player: TeamPlayer): TeamPlayer {
  const index = state.playerOrder.indexOf(player);
  return state.playerOrder[(index + 1) % state.playerOrder.length];
}

function firstOpponent(state: TeamGameState, player: TeamPlayer): TeamPlayer {
  let candidate = nextPlayer(state, player);
  while (state.teams[candidate] === state.teams[player]) candidate = nextPlayer(state, candidate);
  return candidate;
}

function bestTeamPoint(state: TeamGameState, team: Team): number {
  return Math.max(...state.playerOrder.filter(player => state.teams[player] === team).map(player => state.envidoPoints[player]));
}

function teamHasFlor(state: TeamGameState, team: Team): boolean {
  return state.playerOrder.some(player => state.teams[player] === team && state.hasFlor[player]);
}

function allPlayedFirst(state: TeamGameState): boolean {
  return state.playerOrder.some(player => state.playedFirst[player]);
}

function teamOfHandMano(state: TeamGameState): Team {
  return state.teams[state.handMano];
}

export function createTeamGameState(mode: TeamMode, seed = Date.now()): TeamGameState {
  const { teamSize, target } = getTeamModeConfig(mode);
  const playerOrder = slotsFor(mode);
  const teams = Object.fromEntries(playerOrder.map((player, index) => [player, teamForSeat(index + 1)])) as Record<TeamPlayer, Team>;
  return {
    kind: "team", mode, teamSize, playerOrder, teams,
    phase: "waiting", turn: "p1", mano: "p1", handMano: "p1",
    score: { A: 0, B: 0 }, target,
    hands: emptyRecord(playerOrder, []), table: [], roundWins: [],
    trucoLevel: 1, trucoCaller: null, lastTrucoCaller: null,
    envidoChain: [], envidoBet: 0, envidoCaller: null, envidoResolved: false,
    envidoPoints: emptyRecord(playerOrder, 0), hasFlor: emptyRecord(playerOrder, false),
    florChain: [], florBet: 0, florCaller: null,
    playedFirst: emptyRecord(playerOrder, false), winner: null, seed, vira: null,
    turnStartedAt: Date.now(), turnTimeoutMs: TURN_TIMEOUT_MS,
  };
}

export function dealTeamHand(state: TeamGameState): TeamGameState {
  const deck = makeDeckSeeded(state.seed + state.score.A * 37 + state.score.B * 73 + state.roundWins.length);
  const hands = emptyRecord<Card[]>(state.playerOrder, []);
  const envidoPoints = emptyRecord(state.playerOrder, 0);
  const hasFlor = emptyRecord(state.playerOrder, false);
  for (const player of state.playerOrder) {
    const hand = deck.splice(0, 3);
    hands[player] = hand;
    const values = calcEnvido(hand);
    envidoPoints[player] = values.pts;
    hasFlor[player] = values.hasFlor;
  }
  const vira = deck.shift() ?? null;
  const handMano = state.mano;
  return {
    ...state, phase: "playing", hands, envidoPoints, hasFlor, vira,
    handMano, mano: nextPlayer(state, handMano), turn: handMano,
    table: [], roundWins: [], trucoLevel: 1, trucoCaller: null, lastTrucoCaller: null,
    envidoChain: [], envidoBet: 0, envidoCaller: null, envidoResolved: false,
    florChain: [], florBet: 0, florCaller: null, playedFirst: emptyRecord(state.playerOrder, false),
    turnStartedAt: Date.now(),
  };
}

export function resolveTeamRound(table: TeamTableEntry[]): { result: TeamRoundResult; winningPlayer: TeamPlayer | null } {
  if (!table.length) throw new Error("No cards on table");
  const strongest = Math.max(...table.map(entry => entry.card.tv));
  const strongestEntries = table.filter(entry => entry.card.tv === strongest);
  const teams = new Set(strongestEntries.map(entry => entry.team));
  if (teams.size !== 1) return { result: "draw", winningPlayer: null };
  return { result: strongestEntries[0].team, winningPlayer: strongestEntries[0].player };
}

export function determineTeamHandWinner(roundWins: TeamRoundResult[], manoTeam: Team): Team | null {
  const aWins = roundWins.filter(result => result === "A").length;
  const bWins = roundWins.filter(result => result === "B").length;
  if (aWins >= 2) return "A";
  if (bWins >= 2) return "B";
  if (roundWins.length >= 3) return aWins === bWins ? manoTeam : aWins > bWins ? "A" : "B";
  if (roundWins.length === 2 && roundWins.includes("draw")) {
    if (roundWins.includes("A")) return "A";
    if (roundWins.includes("B")) return "B";
  }
  return null;
}

export function playTeamCard(state: TeamGameState, player: TeamPlayer, cardId: string): TeamPlayResult {
  if (state.phase !== "playing" || state.turn !== player) throw new Error(`Not ${player}'s turn`);
  const index = state.hands[player].findIndex(card => card.id === cardId);
  if (index < 0) throw new Error("Card not in hand");
  if (state.table.some(entry => entry.player === player)) throw new Error("Player already played this trick");
  const card = state.hands[player][index];
  const hands = { ...state.hands, [player]: state.hands[player].filter((_, cardIndex) => cardIndex !== index) };
  const table = [...state.table, { card, player, team: state.teams[player] }];
  const next = { ...state, hands, table, playedFirst: { ...state.playedFirst, [player]: true }, turnStartedAt: Date.now() };
  if (table.length < state.playerOrder.length) return { state: { ...next, turn: nextPlayer(state, player) } };

  const resolved = resolveTeamRound(table);
  const roundWins = [...state.roundWins, resolved.result];
  const handWinner = determineTeamHandWinner(roundWins, teamOfHandMano(state));
  if (handWinner) {
    const score = { ...state.score, [handWinner]: state.score[handWinner] + TRUCO_POINTS[state.trucoLevel] };
    const gameWinner = score[handWinner] >= state.target ? handWinner : undefined;
    return {
      state: { ...next, score, roundWins, phase: gameWinner ? "game_over" : "between_hands", winner: gameWinner ?? null },
      completedTrick: table, roundResult: resolved.result, handWinner, gameWinner,
    };
  }
  const leader = resolved.winningPlayer ?? state.handMano;
  return {
    state: { ...next, table: [], roundWins, turn: leader, playedFirst: emptyRecord(state.playerOrder, false) },
    completedTrick: table, roundResult: resolved.result,
  };
}

function assertCallTurn(state: TeamGameState, player: TeamPlayer) {
  if (state.phase !== "playing" || state.turn !== player) throw new Error(`Not ${player}'s turn`);
}

function scoreTeam(state: TeamGameState, team: Team, points: number, patch: Partial<TeamGameState> = {}) {
  const score = { ...state.score, [team]: state.score[team] + points };
  const gameWinner = score[team] >= state.target ? team : undefined;
  const phase: TeamPhase = gameWinner ? "game_over" : (patch.phase ?? state.phase);
  return { state: { ...state, ...patch, score, phase, winner: gameWinner ?? null, turnStartedAt: Date.now() }, gameWinner };
}

export function callTeamTruco(state: TeamGameState, caller: TeamPlayer): TeamGameState {
  assertCallTurn(state, caller);
  if (state.trucoLevel >= 4 || state.lastTrucoCaller && state.teams[state.lastTrucoCaller] === state.teams[caller]) throw new Error("Invalid truco raise");
  return { ...state, phase: "truco_neg", trucoLevel: state.trucoLevel + 1, trucoCaller: caller, lastTrucoCaller: caller, turn: firstOpponent(state, caller), turnStartedAt: Date.now() };
}

export function acceptTeamTruco(state: TeamGameState, responder: TeamPlayer): TeamGameState {
  if (state.phase !== "truco_neg" || !state.trucoCaller || state.teams[responder] === state.teams[state.trucoCaller]) throw new Error("No opposing truco to accept");
  return { ...state, phase: "playing", turn: state.trucoCaller, turnStartedAt: Date.now() };
}

export function refuseTeamTruco(state: TeamGameState, responder: TeamPlayer) {
  if (state.phase !== "truco_neg" || !state.trucoCaller || state.teams[responder] === state.teams[state.trucoCaller]) throw new Error("No opposing truco to refuse");
  const winner = state.teams[state.trucoCaller];
  const points = state.trucoLevel === 2 ? 1 : TRUCO_POINTS[state.trucoLevel - 1];
  return { ...scoreTeam(state, winner, points, { phase: "between_hands" }), handWinner: winner, points };
}

export function callTeamEnvido(state: TeamGameState, caller: TeamPlayer, action: string): TeamGameState {
  assertCallTurn(state, caller);
  if (state.envidoResolved || allPlayedFirst(state) || teamHasFlor(state, "A") || teamHasFlor(state, "B")) throw new Error("Envido unavailable");
  if (!["envido", "envido2", "real_envido", "falta_envido"].includes(action)) throw new Error("Invalid envido action");
  const chain = [...state.envidoChain, action];
  const bet = getEnvidoBet(chain);
  return { ...state, phase: "envido_neg", envidoChain: chain, envidoBet: bet === -1 ? state.target : bet, envidoCaller: caller, turn: firstOpponent(state, caller), turnStartedAt: Date.now() };
}

export function acceptTeamEnvido(state: TeamGameState, responder: TeamPlayer) {
  if (state.phase !== "envido_neg" || !state.envidoCaller || state.teams[responder] === state.teams[state.envidoCaller]) throw new Error("No opposing envido to accept");
  const aPoints = bestTeamPoint(state, "A"); const bPoints = bestTeamPoint(state, "B");
  const winner: Team = aPoints === bPoints ? teamOfHandMano(state) : aPoints > bPoints ? "A" : "B";
  const points = state.envidoBet === -1 ? Math.max(0, state.target - state.score[winner]) : state.envidoBet;
  const result = scoreTeam(state, winner, points, { envidoResolved: true, phase: "playing", turn: state.handMano });
  return { ...result, envidoWinner: winner, points };
}

export function refuseTeamEnvido(state: TeamGameState, responder: TeamPlayer) {
  if (state.phase !== "envido_neg" || !state.envidoCaller || state.teams[responder] === state.teams[state.envidoCaller]) throw new Error("No opposing envido to refuse");
  const winner = state.teams[state.envidoCaller]; const points = getEnvidoRefusalPoints(state.envidoChain);
  return { ...scoreTeam(state, winner, points, { envidoResolved: true, phase: "playing", turn: state.handMano }), points };
}

export function callTeamFlor(state: TeamGameState, caller: TeamPlayer, action: string): TeamGameState {
  const initial = state.phase === "playing"; const counter = state.phase === "flor_neg";
  if ((!initial && !counter) || (initial && state.turn !== caller) || !state.hasFlor[caller] || allPlayedFirst(state)) throw new Error("Flor unavailable");
  if ((initial && action !== "flor") || (counter && state.florCaller && state.teams[state.florCaller] === state.teams[caller])) throw new Error("Invalid flor action");
  const chain = [...state.florChain, action]; const bet = getFlorBet(chain);
  return { ...state, phase: "flor_neg", florChain: chain, florBet: bet === -1 ? state.target : bet, florCaller: caller, turn: firstOpponent(state, caller), turnStartedAt: Date.now() };
}

export function acceptTeamFlor(state: TeamGameState, responder: TeamPlayer) {
  if (state.phase !== "flor_neg" || !state.florCaller || state.teams[responder] === state.teams[state.florCaller]) throw new Error("No opposing flor to accept");
  const a = bestTeamPoint(state, "A"); const b = bestTeamPoint(state, "B"); const winner: Team = a === b ? teamOfHandMano(state) : a > b ? "A" : "B";
  const points = state.florBet === -1 ? Math.max(0, state.target - state.score[winner]) : state.florBet;
  return { ...scoreTeam(state, winner, points, { phase: "playing", turn: state.handMano }), florWinner: winner, points };
}

export function refuseTeamFlor(state: TeamGameState, responder: TeamPlayer) {
  if (state.phase !== "flor_neg" || !state.florCaller || state.teams[responder] === state.teams[state.florCaller]) throw new Error("No opposing flor to refuse");
  const winner = state.teams[state.florCaller]; const points = getFlorRefusalPoints(state.florChain);
  return { ...scoreTeam(state, winner, points, { phase: "playing", turn: state.handMano }), points };
}

export function getTeamPlayerView(state: TeamGameState, player: TeamPlayer) {
  const hands = Object.fromEntries(state.playerOrder.map(slot => [slot, slot === player ? state.hands[slot] : []]));
  const cardCounts = Object.fromEntries(state.playerOrder.map(slot => [slot, state.hands[slot].length]));
  return { ...state, hands, cardCounts, myHand: state.hands[player], team: state.teams[player] };
}

export function canTeamPlayerAct(state: TeamGameState, player: TeamPlayer) {
  if (state.phase === "playing") return state.turn === player;
  const caller = state.trucoCaller ?? state.envidoCaller ?? state.florCaller;
  return Boolean(caller && state.teams[caller] !== state.teams[player]);
}
