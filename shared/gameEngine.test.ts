import { describe, it, expect } from "vitest";
import {
  createGameState, dealHand, playCard, callTruco, acceptTruco,
  refuseTruco, callEnvido, acceptEnvido, refuseEnvido, callFlor, acceptFlor,
  fold, getPlayerView, TRUCO_POINTS, TURN_TIMEOUT_MS, isTurnExpired,
} from "./gameEngine";

describe("Game Engine", () => {
  it("creates a valid initial game state", () => {
    const state = createGameState();
    expect(state.phase).toBe("waiting");
    expect(state.score.p1).toBe(0);
    expect(state.score.p2).toBe(0);
    expect(state.target).toBe(12);
    expect(state.trucoLevel).toBe(1);
  });

  it("deals 3 cards to each player (pure function returns new state)", () => {
    const state = createGameState();
    const dealt = dealHand(state);
    expect(dealt.hands.p1.length).toBe(3);
    expect(dealt.hands.p2.length).toBe(3);
    expect(dealt.phase).toBe("playing");
    // Original state should be unchanged
    expect(state.phase).toBe("waiting");
  });

  it("cards have valid properties", () => {
    const dealt = dealHand(createGameState());
    for (const card of [...dealt.hands.p1, ...dealt.hands.p2]) {
      expect(card).toHaveProperty("id");
      expect(card).toHaveProperty("rank");
      expect(card).toHaveProperty("suit");
      expect(card).toHaveProperty("tv");
      expect(card).toHaveProperty("ev");
      expect(["Espadas", "Bastos", "Copas", "Ouros"]).toContain(card.suit);
    }
  });

  it("allows playing a card when it is the player's turn", () => {
    const dealt = dealHand(createGameState());
    const currentPlayer = dealt.turn;
    const card = dealt.hands[currentPlayer][0];
    const result = playCard(dealt, currentPlayer, card.id);
    expect(result.state.hands[currentPlayer].length).toBe(2);
    expect(result.state.table.length).toBeGreaterThan(0);
  });

  it("keeps both cards of a resolved trick available for the visual result", () => {
    const dealt = dealHand(createGameState());
    const firstPlayer = dealt.turn;
    const secondPlayer = firstPlayer === "p1" ? "p2" : "p1";
    const afterFirst = playCard(dealt, firstPlayer, dealt.hands[firstPlayer][0].id).state;
    const resolved = playCard(afterFirst, secondPlayer, afterFirst.hands[secondPlayer][0].id);

    expect(resolved.roundResult).toBeDefined();
    expect(resolved.completedTrick).toHaveLength(2);
    expect(resolved.completedTrick?.map(entry => entry.player).sort()).toEqual(["p1", "p2"]);
  });

  it("rejects playing a card when it is not the player's turn", () => {
    const dealt = dealHand(createGameState());
    const otherPlayer = dealt.turn === "p1" ? "p2" : "p1";
    const card = dealt.hands[otherPlayer][0];
    expect(() => playCard(dealt, otherPlayer, card.id)).toThrow();
  });

  it("handles truco call correctly (returns new state)", () => {
    const dealt = dealHand(createGameState());
    const caller = dealt.turn;
    const trucoed = callTruco(dealt, caller);
    expect(trucoed.phase).toBe("truco_neg");
    expect(trucoed.trucoCaller).toBe(caller);
    expect(trucoed.trucoLevel).toBe(2);
  });

  it("handles truco accept correctly", () => {
    const dealt = dealHand(createGameState());
    const caller = dealt.turn;
    const trucoed = callTruco(dealt, caller);
    const accepted = acceptTruco(trucoed);
    expect(accepted.trucoLevel).toBe(2);
    expect(accepted.phase).toBe("playing");
  });

  it("rejects retries of card, Truco call and Truco acceptance", () => {
    const dealt = dealHand(createGameState());
    const player = dealt.turn;
    const card = dealt.hands[player][0];
    const played = playCard(dealt, player, card.id).state;
    expect(() => playCard(played, player, card.id)).toThrow();

    const freshHand = dealHand(createGameState());
    const caller = freshHand.turn;
    const trucoed = callTruco(freshHand, caller);
    expect(() => callTruco(trucoed, caller)).toThrow();
    const accepted = acceptTruco(trucoed);
    expect(() => acceptTruco(accepted)).toThrow();
  });

  it("handles truco refuse correctly", () => {
    const dealt = dealHand(createGameState());
    const caller = dealt.turn;
    const trucoed = callTruco(dealt, caller);
    const result = refuseTruco(trucoed);
    // Caller should get points
    expect(result.state.score[caller]).toBeGreaterThan(0);
    expect(result.handWinner).toBe(caller);
  });

  it("handles fold correctly", () => {
    const dealt = dealHand(createGameState());
    const folder = dealt.turn;
    const other = folder === "p1" ? "p2" : "p1";
    const result = fold(dealt, folder);
    expect(result.state.score[other]).toBeGreaterThan(0);
    expect(result.handWinner).toBe(other);
  });

  it("allows a player to fold their own hand outside the current turn", () => {
    const dealt = dealHand(createGameState());
    const player = dealt.turn === "p1" ? "p2" : "p1";
    const winner = player === "p1" ? "p2" : "p1";
    const result = fold(dealt, player);
    expect(result.handWinner).toBe(winner);
    expect(result.state.score[winner]).toBe(1);
  });

  it("getPlayerView hides opponent cards", () => {
    const dealt = dealHand(createGameState());
    const view = getPlayerView(dealt, "p1");
    expect(view.myHand).toBeDefined();
    expect(view.myHand.length).toBe(3);
    expect(view.opponentCardCount).toBe(3);
    // Should not expose opponent's actual hands
    expect(view).not.toHaveProperty("hands");
  });

  it("TRUCO_POINTS has correct values (1, 2, 3, 4)", () => {
    expect(TRUCO_POINTS[1]).toBe(1);
    expect(TRUCO_POINTS[2]).toBe(2);
    expect(TRUCO_POINTS[3]).toBe(3);
    expect(TRUCO_POINTS[4]).toBe(4);
  });

  it("plays a full hand (up to 3 rounds)", () => {
    let state = dealHand(createGameState());
    let moves = 0;
    while (state.phase === "playing" && moves < 10) {
      const p = state.turn;
      if (state.hands[p].length === 0) break;
      const card = state.hands[p][0];
      try {
        const r = playCard(state, p, card.id);
        state = r.state;
        moves++;
      } catch {
        break;
      }
    }
    // After playing, some score should have been awarded or game still going
    expect(moves).toBeGreaterThan(0);
  });

  it("seeded games produce deterministic results", () => {
    const s1 = dealHand(createGameState(42));
    const s2 = dealHand(createGameState(42));
    expect(s1.hands.p1.map(c => c.id)).toEqual(s2.hands.p1.map(c => c.id));
    expect(s1.hands.p2.map(c => c.id)).toEqual(s2.hands.p2.map(c => c.id));
  });

  it("rejects an AFK turn after the configured timeout", () => {
    const dealt = dealHand(createGameState());
    const expired = { ...dealt, turnStartedAt: Date.now() - TURN_TIMEOUT_MS - 1 };
    expect(isTurnExpired(expired)).toBe(true);
    expect(() => playCard(expired, expired.turn, expired.hands[expired.turn][0].id)).toThrow("Turn timed out");
  });

  it("blocks Envido after the first card is played", () => {
    const dealt = dealHand(createGameState());
    const firstPlayer = dealt.turn;
    const played = playCard(dealt, firstPlayer, dealt.hands[firstPlayer][0].id).state;
    expect(() => callEnvido(played, played.turn, "envido")).toThrow("after the first card");
  });

  it("awards an Envido tie to the hand player", () => {
    const dealt = dealHand(createGameState());
    const noFlor = { ...dealt, hasFlor: { p1: false, p2: false } };
    const negotiation = callEnvido(noFlor, noFlor.turn, "envido");
    const tied = { ...negotiation, envidoPoints: { p1: 20, p2: 20 } };
    const result = acceptEnvido(tied, tied.turn);
    expect(result.envidoWinner).toBe(dealt.handMano);
  });

  it("ends the game when accepted Envido reaches the target", () => {
    const dealt = dealHand(createGameState(31, 12));
    const pending = { ...dealt, phase: "envido_neg" as const, turn: "p2" as const, score: { p1: 11, p2: 0 }, envidoCaller: "p1" as const, envidoBet: 2, envidoPoints: { p1: 33, p2: 20 } };
    const result = acceptEnvido(pending, "p2");
    expect(result.gameWinner).toBe("p1");
    expect(result.state.phase).toBe("game_over");
  });

  it("allows and resolves a counter-flor sequence", () => {
    const dealt = dealHand(createGameState(32, 12));
    const first = { ...dealt, hasFlor: { p1: true, p2: true } };
    const flor = callFlor(first, first.turn, "flor");
    const raised = callFlor(flor, flor.turn, "contra_flor");
    expect(raised.florChain).toEqual(["flor", "contra_flor"]);
    const accepted = acceptFlor(raised, raised.turn);
    expect(accepted.points).toBeGreaterThan(0);
  });
});
