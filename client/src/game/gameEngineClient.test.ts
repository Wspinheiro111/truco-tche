import { describe, expect, it } from "vitest";
import { createGameState, dealHand, playCard } from "@shared/gameEngine";

describe("adaptação cliente do motor de Truco", () => {
  it("consome o motor compartilhado sem dependência do script legado", () => {
    const dealt = dealHand(createGameState());
    const currentPlayer = dealt.turn;
    const otherPlayer = currentPlayer === "p1" ? "p2" : "p1";

    const result = playCard(dealt, currentPlayer, dealt.hands[currentPlayer][0].id);

    expect(result.state.hands[currentPlayer]).toHaveLength(2);
    expect(result.state.table).toHaveLength(1);
    expect(() => playCard(dealt, otherPlayer, dealt.hands[otherPlayer][0].id)).toThrow();
  });
});
