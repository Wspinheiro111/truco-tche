import { describe, expect, it } from "vitest";
import { acceptTeamEnvido, callTeamEnvido, callTeamTruco, createTeamGameState, dealTeamHand, getTeamModeConfig, playTeamCard, teamForSeat } from "./teamGameEngine";

describe("team game engine", () => {
  it("creates alternating team seats and deals three unique cards to each player", () => {
    const state = dealTeamHand(createTeamGameState("2v2", 42));
    expect(state.playerOrder).toEqual(["p1", "p2", "p3", "p4"]);
    expect(state.teams).toMatchObject({ p1: "A", p2: "B", p3: "A", p4: "B" });
    expect(state.playerOrder.flatMap(player => state.hands[player])).toHaveLength(12);
    expect(new Set(state.playerOrder.flatMap(player => state.hands[player].map(card => card.id))).size).toBe(12);
  });

  it("requires every seat to play before resolving a trick in trios", () => {
    let state = dealTeamHand(createTeamGameState("3v3", 99));
    for (let index = 0; index < 5; index += 1) {
      const player = state.turn;
      state = playTeamCard(state, player, state.hands[player][0].id).state;
      expect(state.table).toHaveLength(index + 1);
    }
    const player = state.turn;
    const result = playTeamCard(state, player, state.hands[player][0].id);
    expect(result.completedTrick).toHaveLength(6);
  });

  it("defines capacities and alternating teams for every supported mode", () => {
    expect(getTeamModeConfig("2v2").playerCount).toBe(4);
    expect(getTeamModeConfig("3v3").playerCount).toBe(6);
    expect([1, 2, 3, 4, 5, 6].map(teamForSeat)).toEqual(["A", "B", "A", "B", "A", "B"]);
  });

  it("allows the turn player to call a team truco and an opponent team member to accept envido", () => {
    const state = dealTeamHand(createTeamGameState("2v2", 17));
    const truco = callTeamTruco(state, "p1");
    expect(truco.phase).toBe("truco_neg");
    expect(truco.turn).toBe("p2");
    const envido = callTeamEnvido(state, "p1", "envido");
    const accepted = acceptTeamEnvido(envido, "p2");
    expect(accepted.state.envidoResolved).toBe(true);
    expect(["A", "B"]).toContain(accepted.envidoWinner);
  });
});
