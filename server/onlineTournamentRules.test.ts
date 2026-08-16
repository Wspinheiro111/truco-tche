import { describe, expect, it } from "vitest";
import {
  buildOneVsOneOpeningRound,
  roundCountForCapacity,
  validateOneVsOneCapacity,
} from "./onlineTournamentRules";

const entrants = Array.from({ length: 6 }, (_, index) => ({
  userId: index + 1,
  userName: `Jogador ${index + 1}`,
}));

describe("onlineTournamentRules", () => {
  it("accepts only even 1×1 capacities from 2 through 64", () => {
    expect(validateOneVsOneCapacity(2)).toBeNull();
    expect(validateOneVsOneCapacity(30)).toBeNull();
    expect(validateOneVsOneCapacity(3)).toContain("par");
    expect(validateOneVsOneCapacity(66)).toContain("64");
  });

  it("calculates enough rounds for non-power-of-two capacities", () => {
    expect(roundCountForCapacity(2)).toBe(1);
    expect(roundCountForCapacity(6)).toBe(3);
    expect(roundCountForCapacity(30)).toBe(5);
  });

  it("draws every enrolled player exactly once in the opening matches", () => {
    const openingRound = buildOneVsOneOpeningRound(entrants, () => 0.25);
    const drawnIds = openingRound.flatMap((match) => [match.p1UserId, match.p2UserId].filter(Boolean));
    expect(openingRound).toHaveLength(3);
    expect(new Set(drawnIds)).toEqual(new Set(entrants.map((entrant) => entrant.userId)));
  });
});
