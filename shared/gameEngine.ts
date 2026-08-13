/**
 * Truco Tchê — Game Engine (shared between server and client)
 * Server-authoritative: all game logic runs here.
 */

// ── Types ──
export interface Card {
  id: string;
  rank: number;
  suit: string;
  tv: number;   // truco value (strength)
  ev: number;   // envido value
}

export type Player = 'p1' | 'p2';
export type Phase =
  | 'waiting' | 'playing' | 'truco_neg' | 'envido_neg'
  | 'flor_neg' | 'game_over' | 'between_hands';
export type RoundResult = 'p1' | 'p2' | 'draw';

export interface TableEntry {
  card: Card;
  player: Player;
}

export interface GameState {
  phase: Phase;
  turn: Player;
  mano: Player;          // who deals (alternates)
  handMano: Player;      // who is mano this hand
  score: { p1: number; p2: number };
  target: number;        // 12 for 1v1
  hands: { p1: Card[]; p2: Card[] };
  table: TableEntry[];
  roundWins: RoundResult[];
  trucoLevel: number;    // 1=normal, 2=truco, 3=retruco, 4=vale4
  trucoCaller: Player | null;
  lastTrucoCaller: Player | null;
  envidoChain: string[];
  envidoBet: number;
  envidoCaller: Player | null;
  envidoResolved: boolean;
  envidoPoints: { p1: number; p2: number };
  hasFlor: { p1: boolean; p2: boolean };
  florChain: string[];
  florBet: number;
  florCaller: Player | null;
  trucoPendingEnvido: boolean;
  playedFirst: { p1: boolean; p2: boolean };
  winner: Player | null;
  seed: number;
  vira: Card | null;   // carta virada para determinar manilha
  /** Timestamp (UTC milliseconds) at which the current turn started. */
  turnStartedAt: number;
  /** Maximum duration of the current turn in milliseconds. */
  turnTimeoutMs: number;
}

// ── Constants ──
export const SUITS = ['Ouros', 'Bastos', 'Espadas', 'Copas'] as const;
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const;
export const TARGET_1V1 = 12;
export const TARGET_TEAM = 24;
export const TRUCO_POINTS: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4 };
export const TRUCO_NAMES: Record<number, string> = {
  1: 'Normal', 2: 'Truco', 3: 'Retruco', 4: 'Vale Quatro',
};
export const TURN_TIMEOUT_MS = 30_000;

// ── Card Value Functions ──
export function trucoValue(rank: number, suit: string): number {
  if (rank === 1 && suit === 'Espadas') return 14;
  if (rank === 1 && suit === 'Bastos') return 13;
  if (rank === 7 && suit === 'Espadas') return 12;
  if (rank === 7 && suit === 'Ouros') return 11;
  if (rank === 3) return 10;
  if (rank === 2) return 9;
  if (rank === 1) return 8;
  if (rank === 12) return 7;
  if (rank === 11) return 6;
  if (rank === 10) return 5;
  if (rank === 7) return 4;
  if (rank === 6) return 3;
  if (rank === 5) return 2;
  return 1;
}

export function envidoValue(rank: number): number {
  return rank >= 10 ? 0 : rank;
}

export function isManilha(rank: number, suit: string): boolean {
  return trucoValue(rank, suit) >= 11;
}

// ── Seeded Random (deterministic deck) ──
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Deck Creation ──
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${rank}-${suit}`,
        rank,
        suit,
        tv: trucoValue(rank, suit),
        ev: envidoValue(rank),
      });
    }
  }
  return deck;
}

export function makeDeckSeeded(seed: number): Card[] {
  const deck = makeDeck();
  const rng = seededRandom(seed);
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ── Envido Calculation ──
export function calcEnvido(hand: Card[]): { pts: number; hasFlor: boolean } {
  const bySuit: Record<string, Card[]> = {};
  for (const c of hand) {
    if (!bySuit[c.suit]) bySuit[c.suit] = [];
    bySuit[c.suit].push(c);
  }
  let max = 0;
  let florPts = 0;
  let hasFlor = false;
  for (const cards of Object.values(bySuit)) {
    if (cards.length === 3) {
      hasFlor = true;
      florPts = 20 + cards[0].ev + cards[1].ev + cards[2].ev;
    } else if (cards.length === 2) {
      const v = 20 + cards[0].ev + cards[1].ev;
      if (v > max) max = v;
    }
  }
  if (!max && hand.length) max = Math.max(...hand.map(c => c.ev));
  return { pts: hasFlor ? florPts : max, hasFlor };
}

// ── Hand Winner Logic (best of 3 rounds) ──
export function determineHandWinner(roundWins: RoundResult[]): Player | null {
  const len = roundWins.length;
  if (len === 0) return null;

  const p1w = roundWins.filter(r => r === 'p1').length;
  const p2w = roundWins.filter(r => r === 'p2').length;

  // 2 wins = winner
  if (p1w >= 2) return 'p1';
  if (p2w >= 2) return 'p2';

  // After 3 rounds
  if (len >= 3) {
    if (p1w > p2w) return 'p1';
    if (p2w > p1w) return 'p2';
    // All draws or tied: mano wins
    return null; // caller should use handMano
  }

  // After 2 rounds with a draw
  if (len === 2) {
    const hasP1 = roundWins.includes('p1');
    const hasP2 = roundWins.includes('p2');
    const hasDraw = roundWins.includes('draw');
    if (hasDraw && hasP1) return 'p1';
    if (hasDraw && hasP2) return 'p2';
  }

  return null; // not decided yet
}

// ── Round Resolution ──
export function resolveRound(table: TableEntry[]): RoundResult {
  const p1Card = table.find(t => t.player === 'p1');
  const p2Card = table.find(t => t.player === 'p2');
  if (!p1Card || !p2Card) throw new Error('Both players must play a card');
  if (p1Card.card.tv > p2Card.card.tv) return 'p1';
  if (p2Card.card.tv > p1Card.card.tv) return 'p2';
  return 'draw';
}

// ── Envido Bet Calculation ──
export function getEnvidoBet(chain: string[]): number {
  let bet = 0;
  for (const action of chain) {
    switch (action) {
      case 'envido': bet += 2; break;
      case 'envido2': bet += 2; break;
      case 'real_envido': bet += 3; break;
      case 'falta_envido': return -1; // special: rest of points
      default: break;
    }
  }
  return bet;
}

export function getEnvidoRefusalPoints(chain: string[]): number {
  // Points awarded when envido is refused
  if (chain.length === 0) return 0;
  if (chain.length === 1) return 1;
  // Sum all but last, then +1
  let pts = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    if (a === 'envido' || a === 'envido2') pts += 2;
    else if (a === 'real_envido') pts += 3;
  }
  return pts || 1;
}

// ── Flor Bet Calculation ──
export function getFlorBet(chain: string[]): number {
  let bet = 0;
  for (const action of chain) {
    switch (action) {
      case 'flor': bet += 3; break;
      case 'contra_flor': bet += 6; break;
      case 'contra_flor_resto': return -1; // rest of points
      default: break;
    }
  }
  return bet;
}

export function getFlorRefusalPoints(chain: string[]): number {
  if (chain.length <= 1) return 3;
  return chain.length === 2 ? 3 : 6;
}

// ── Create Initial Game State ──
export function createGameState(seed?: number, target?: number): GameState {
  const s = seed ?? Date.now();
  return {
    phase: 'waiting',
    turn: 'p1',
    mano: 'p1',
    handMano: 'p1',
    score: { p1: 0, p2: 0 },
    target: target ?? TARGET_1V1,
    hands: { p1: [], p2: [] },
    table: [],
    roundWins: [],
    trucoLevel: 1,
    trucoCaller: null,
    lastTrucoCaller: null,
    envidoChain: [],
    envidoBet: 0,
    envidoCaller: null,
    envidoResolved: false,
    envidoPoints: { p1: 0, p2: 0 },
    hasFlor: { p1: false, p2: false },
    florChain: [],
    florBet: 0,
    florCaller: null,
    trucoPendingEnvido: false,
    playedFirst: { p1: false, p2: false },
    winner: null,
    seed: s,
    vira: null,
    turnStartedAt: Date.now(),
    turnTimeoutMs: TURN_TIMEOUT_MS,
  };
}

// ── Deal a New Hand ──
export function dealHand(state: GameState): GameState {
  const handSeed = state.seed + state.score.p1 * 37 + state.score.p2 * 73 + state.roundWins.length;
  const deck = makeDeckSeeded(handSeed);
  const p1Hand = deck.splice(0, 3);
  const p2Hand = deck.splice(0, 3);
  const vira = deck.splice(0, 1)[0] ?? null; // carta virada para manilha
  const p1Env = calcEnvido(p1Hand);
  const p2Env = calcEnvido(p2Hand);
  const thisMano = state.mano;
  const nextMano: Player = thisMano === 'p1' ? 'p2' : 'p1';

  return {
    ...state,
    phase: 'playing',
    hands: { p1: p1Hand, p2: p2Hand },
    table: [],
    roundWins: [],
    turn: thisMano,
    handMano: thisMano,
    mano: nextMano,
    trucoLevel: 1,
    trucoCaller: null,
    lastTrucoCaller: null,
    envidoChain: [],
    envidoBet: 0,
    envidoCaller: null,
    envidoResolved: false,
    envidoPoints: { p1: p1Env.pts, p2: p2Env.pts },
    hasFlor: { p1: p1Env.hasFlor, p2: p2Env.hasFlor },
    florChain: [],
    florBet: 0,
    florCaller: null,
    trucoPendingEnvido: false,
    playedFirst: { p1: false, p2: false },
    vira,
    turnStartedAt: Date.now(),
    turnTimeoutMs: state.turnTimeoutMs || TURN_TIMEOUT_MS,
  };
}

// ── Turn timeout ──
export function isTurnExpired(state: GameState, now = Date.now()): boolean {
  if (state.phase !== 'playing') return false;
  const timeoutMs = state.turnTimeoutMs || TURN_TIMEOUT_MS;
  return Number.isFinite(state.turnStartedAt) && now - state.turnStartedAt >= timeoutMs;
}

// ── Play a Card ──
export function playCard(
  state: GameState,
  player: Player,
  cardId: string
): { state: GameState; roundResult?: RoundResult; handWinner?: Player; gameWinner?: Player } {
  if (state.phase !== 'playing' || state.turn !== player) {
    throw new Error(`Not ${player}'s turn`);
  }
  if (isTurnExpired(state)) {
    throw new Error('Turn timed out');
  }
  // Already played this round?
  if (state.table.some(t => t.player === player)) {
    throw new Error(`${player} already played this round`);
  }
  const hand = state.hands[player];
  const cardIdx = hand.findIndex(c => c.id === cardId);
  if (cardIdx === -1) throw new Error('Card not in hand');

  const card = hand[cardIdx];
  const newHand = [...hand];
  newHand.splice(cardIdx, 1);

  const newTable = [...state.table, { card, player }];
  const newState: GameState = {
    ...state,
    hands: { ...state.hands, [player]: newHand },
    table: newTable,
    playedFirst: { ...state.playedFirst, [player]: true },
    turnStartedAt: Date.now(),
  };

  // Both played?
  const otherPlayer: Player = player === 'p1' ? 'p2' : 'p1';
  if (newTable.some(t => t.player === otherPlayer)) {
    // Resolve round
    const roundResult = resolveRound(newTable);
    const newRoundWins = [...state.roundWins, roundResult];
    const handWinner = determineHandWinner(newRoundWins);

    // If hand is tied after 3 rounds, mano wins
    const actualHandWinner = handWinner ?? (newRoundWins.length >= 3 ? state.handMano : null);

    if (actualHandWinner) {
      const pts = TRUCO_POINTS[state.trucoLevel];
      const newScore = { ...state.score };
      newScore[actualHandWinner] += pts;

      if (newScore[actualHandWinner] >= state.target) {
        return {
          state: {
            ...newState,
            score: newScore,
            roundWins: newRoundWins,
            table: newTable,
            phase: 'game_over',
            winner: actualHandWinner,
          },
          roundResult,
          handWinner: actualHandWinner,
          gameWinner: actualHandWinner,
        };
      }

      return {
        state: {
          ...newState,
          score: newScore,
          roundWins: newRoundWins,
          table: newTable,
          phase: 'between_hands', // estado transitório antes de dealHand
          turnStartedAt: Date.now(),
        },
        roundResult,
        handWinner: actualHandWinner,
      };
    }

    // Next round: winner leads (or mano if draw)
    const nextTurn = roundResult === 'draw' ? state.handMano : roundResult;
    return {
      state: {
        ...newState,
        roundWins: newRoundWins,
        table: [],
        turn: nextTurn,
        playedFirst: { p1: false, p2: false },
        turnStartedAt: Date.now(),
      },
      roundResult,
    };
  }

  // Waiting for other player
  return {
    state: {
      ...newState,
      turn: otherPlayer,
      turnStartedAt: Date.now(),
    },
  };
}

// ── Truco Actions ──
export function callTruco(state: GameState, caller: Player): GameState {
  if (state.phase !== 'playing' || state.turn !== caller) {
    throw new Error(`Not ${caller}'s turn`);
  }
  const level = state.trucoLevel + 1;
  if (level > 4) throw new Error('Already at max truco level');
  if (state.lastTrucoCaller === caller) throw new Error('Cannot raise own truco');
  return {
    ...state,
    phase: 'truco_neg',
    trucoLevel: level,
    trucoCaller: caller,
    lastTrucoCaller: caller,
    turn: caller === 'p1' ? 'p2' : 'p1',
    turnStartedAt: Date.now(),
  };
}

export function acceptTruco(state: GameState, responder?: Player): GameState {
  if (state.phase !== 'truco_neg' || !state.trucoCaller) {
    throw new Error('No truco pending');
  }
  if (responder && state.turn !== responder) {
    throw new Error(`Not ${responder}'s turn`);
  }
  return {
    ...state,
    phase: 'playing',
    turn: state.trucoCaller,
    turnStartedAt: Date.now(),
  };
}

export function refuseTruco(
  state: GameState,
  responder?: Player,
): { state: GameState; handWinner: Player; gameWinner?: Player } {
  if (state.phase !== 'truco_neg' || !state.trucoCaller) {
    throw new Error('No truco pending');
  }
  if (responder && state.turn !== responder) {
    throw new Error(`Not ${responder}'s turn`);
  }
  const winner = state.trucoCaller;
  const pts = state.trucoLevel === 2 ? 1 : TRUCO_POINTS[state.trucoLevel - 1];
  const newScore = { ...state.score };
  newScore[winner] += pts;

  if (newScore[winner] >= state.target) {
    return {
      state: { ...state, score: newScore, phase: 'game_over', winner, turnStartedAt: Date.now() },
      handWinner: winner,
      gameWinner: winner,
    };
  }

  return {
    state: { ...state, score: newScore, turnStartedAt: Date.now() },
    handWinner: winner,
  };
}

export function raiseTruco(state: GameState, raiser: Player): GameState {
  if (state.phase !== 'truco_neg' || state.turn !== raiser) {
    throw new Error(`Not ${raiser}'s turn to raise truco`);
  }
  const level = state.trucoLevel + 1;
  if (level > 4) throw new Error('Already at max truco level');
  if (state.lastTrucoCaller === raiser) throw new Error('Cannot raise own truco');
  return {
    ...state,
    trucoLevel: level,
    trucoCaller: raiser,
    lastTrucoCaller: raiser,
    turn: raiser === 'p1' ? 'p2' : 'p1',
    turnStartedAt: Date.now(),
  };
}

// ── Envido Actions ──
export function callEnvido(
  state: GameState,
  caller: Player,
  action: string
): GameState {
  if (state.phase !== 'playing' || state.turn !== caller) {
    throw new Error(`Not ${caller}'s turn`);
  }
  if (state.envidoResolved || state.playedFirst.p1 || state.playedFirst.p2) {
    throw new Error('Envido is no longer available after the first card');
  }
  if (state.hasFlor.p1 || state.hasFlor.p2) {
    throw new Error('Flor has priority over envido');
  }
  if (!['envido', 'envido2', 'real_envido', 'falta_envido'].includes(action)) {
    throw new Error('Invalid envido action');
  }
  const newChain = [...state.envidoChain, action];
  const bet = getEnvidoBet(newChain);
  return {
    ...state,
    phase: 'envido_neg',
    envidoChain: newChain,
    envidoBet: bet === -1 ? state.target : bet,
    envidoCaller: caller,
    turn: caller === 'p1' ? 'p2' : 'p1',
    turnStartedAt: Date.now(),
  };
}

export function acceptEnvido(
  state: GameState,
  responder?: Player,
): { state: GameState; envidoWinner: Player; points: number } {
  if (state.phase !== 'envido_neg' || !state.envidoCaller) {
    throw new Error('No envido pending');
  }
  if (responder && state.turn !== responder) {
    throw new Error(`Not ${responder}'s turn`);
  }
  const bet = state.envidoBet;
  const actualBet = bet === -1
    ? state.target - Math.min(state.score.p1, state.score.p2)
    : bet;
  const winner: Player = state.envidoPoints.p1 > state.envidoPoints.p2
    ? 'p1'
    : state.envidoPoints.p2 > state.envidoPoints.p1
      ? 'p2'
      : state.handMano;
  const newScore = { ...state.score };
  newScore[winner] += actualBet;

  return {
    state: {
      ...state,
      score: newScore,
      envidoResolved: true,
      phase: state.trucoPendingEnvido ? 'truco_neg' : 'playing',
      turn: state.handMano,
      turnStartedAt: Date.now(),
    },
    envidoWinner: winner,
    points: actualBet,
  };
}

export function refuseEnvido(
  state: GameState,
  responder?: Player,
): { state: GameState; points: number } {
  if (state.phase !== 'envido_neg' || !state.envidoCaller) {
    throw new Error('No envido pending');
  }
  if (responder && state.turn !== responder) {
    throw new Error(`Not ${responder}'s turn`);
  }
  const pts = getEnvidoRefusalPoints(state.envidoChain);
  const winner = state.envidoCaller;
  const newScore = { ...state.score };
  newScore[winner] += pts;

  return {
    state: {
      ...state,
      score: newScore,
      envidoResolved: true,
      phase: state.trucoPendingEnvido ? 'truco_neg' : 'playing',
      turn: state.handMano,
      turnStartedAt: Date.now(),
    },
    points: pts,
  };
}

// ── Flor Actions ──
export function callFlor(state: GameState, caller: Player, action: string): GameState {
  if (state.phase !== 'playing' || state.turn !== caller) {
    throw new Error(`Not ${caller}'s turn`);
  }
  if (!state.hasFlor[caller]) throw new Error('Player does not have flor');
  if (state.envidoResolved || state.playedFirst.p1 || state.playedFirst.p2) {
    throw new Error('Flor is no longer available after the first card');
  }
  if (state.florChain.length > 0) throw new Error('Flor is already pending');
  if (!['flor', 'contra_flor', 'contra_flor_resto'].includes(action)) {
    throw new Error('Invalid flor action');
  }
  const newChain = [...state.florChain, action];
  const bet = getFlorBet(newChain);
  return {
    ...state,
    phase: 'flor_neg',
    florChain: newChain,
    florBet: bet === -1 ? state.target : bet,
    florCaller: caller,
    turn: caller === 'p1' ? 'p2' : 'p1',
    turnStartedAt: Date.now(),
  };
}

export function acceptFlor(
  state: GameState,
  responder?: Player,
): { state: GameState; florWinner: Player; points: number } {
  if (state.phase !== 'flor_neg' || !state.florCaller) {
    throw new Error('No flor pending');
  }
  if (responder && state.turn !== responder) {
    throw new Error(`Not ${responder}'s turn`);
  }
  const bet = state.florBet;
  const actualBet = bet === -1
    ? state.target - Math.min(state.score.p1, state.score.p2)
    : bet;
  // Flor uses envido points (same hand)
  const winner: Player = state.envidoPoints.p1 > state.envidoPoints.p2
    ? 'p1'
    : state.envidoPoints.p2 > state.envidoPoints.p1
      ? 'p2'
      : state.handMano;
  const newScore = { ...state.score };
  newScore[winner] += actualBet;

  return {
    state: {
      ...state,
      score: newScore,
      envidoResolved: true,
      phase: 'playing',
      turn: state.handMano,
      turnStartedAt: Date.now(),
    },
    florWinner: winner,
    points: actualBet,
  };
}

export function refuseFlor(
  state: GameState,
  responder?: Player,
): { state: GameState; points: number } {
  if (state.phase !== 'flor_neg' || !state.florCaller) {
    throw new Error('No flor pending');
  }
  if (responder && state.turn !== responder) {
    throw new Error(`Not ${responder}'s turn`);
  }
  const pts = getFlorRefusalPoints(state.florChain);
  const winner = state.florCaller;
  const newScore = { ...state.score };
  newScore[winner] += pts;

  return {
    state: {
      ...state,
      score: newScore,
      envidoResolved: true,
      phase: 'playing',
      turn: state.handMano,
      turnStartedAt: Date.now(),
    },
    points: pts,
  };
}

// ── Fold (correr) ──
export function fold(
  state: GameState,
  player: Player
): { state: GameState; handWinner: Player; gameWinner?: Player } {
  if (!['playing', 'truco_neg', 'envido_neg', 'flor_neg'].includes(state.phase)) {
    throw new Error('Cannot fold outside an active hand');
  }
  const winner: Player = player === 'p1' ? 'p2' : 'p1';
  const newScore = { ...state.score };
  newScore[winner] += 1;

  if (newScore[winner] >= state.target) {
    return {
      state: { ...state, score: newScore, phase: 'game_over', winner, turnStartedAt: Date.now() },
      handWinner: winner,
      gameWinner: winner,
    };
  }

  return {
    state: { ...state, score: newScore, turnStartedAt: Date.now() },
    handWinner: winner,
  };
}

// ── Utility: get player view (hide opponent's cards) ──
export function getPlayerView(state: GameState, player: Player): Partial<GameState> & { myHand: Card[]; opponentCardCount: number } {
  const other: Player = player === 'p1' ? 'p2' : 'p1';
  return {
    phase: state.phase,
    turn: state.turn,
    mano: state.mano,
    handMano: state.handMano,
    score: state.score,
    target: state.target,
    myHand: state.hands[player],
    opponentCardCount: state.hands[other].length,
    table: state.table,
    roundWins: state.roundWins,
    trucoLevel: state.trucoLevel,
    trucoCaller: state.trucoCaller,
    lastTrucoCaller: state.lastTrucoCaller,
    envidoChain: state.envidoChain,
    envidoBet: state.envidoBet,
    envidoCaller: state.envidoCaller,
    envidoResolved: state.envidoResolved,
    envidoPoints: state.envidoResolved ? state.envidoPoints : { p1: 0, p2: 0 },
    hasFlor: state.hasFlor,
    florChain: state.florChain,
    florBet: state.florBet,
    florCaller: state.florCaller,
    trucoPendingEnvido: state.trucoPendingEnvido,
    playedFirst: state.playedFirst,
    winner: state.winner,
    seed: state.seed,
    vira: state.vira,
    turnStartedAt: state.turnStartedAt,
    turnTimeoutMs: state.turnTimeoutMs,
  };
}
