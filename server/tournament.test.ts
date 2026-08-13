/**
 * Tests for the tournament system: bracket helpers and DB utilities.
 */
import { describe, it, expect } from "vitest";
import {
  generateFirstRound,
  generateNextRound,
  isRoundComplete,
  getBracketChampion,
  getRoundName,
  BracketPlayer,
  BracketData,
} from "./tournamentDb";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePlayer(id: number, name: string): BracketPlayer {
  return { id, name, avatar: "🎴", seed: id };
}

const PLAYERS_4 = [
  makePlayer(0, "Alice"),
  makePlayer(1, "Bob"),
  makePlayer(2, "Carlos"),
  makePlayer(3, "Diana"),
];

const PLAYERS_8 = Array.from({ length: 8 }, (_, i) => makePlayer(i, `P${i + 1}`));

// ─── getRoundName ─────────────────────────────────────────────────────────────

describe("getRoundName", () => {
  it("returns 'Final' for 2 players", () => {
    expect(getRoundName(2)).toBe("Final");
  });

  it("returns 'Semifinal' for 4 players", () => {
    expect(getRoundName(4)).toBe("Semifinal");
  });

  it("returns 'Quartas de Final' for 8 players", () => {
    expect(getRoundName(8)).toBe("Quartas de Final");
  });

  it("returns 'Oitavas de Final' for 16 players", () => {
    expect(getRoundName(16)).toBe("Oitavas de Final");
  });

  it("returns a fallback for unusual sizes", () => {
    expect(getRoundName(6)).toContain("6");
  });
});

// ─── generateFirstRound ───────────────────────────────────────────────────────

describe("generateFirstRound", () => {
  it("generates 2 matches for 4 players", () => {
    const round = generateFirstRound(PLAYERS_4);
    expect(round.matches).toHaveLength(2);
  });

  it("seeds top vs bottom: player[0] vs player[3], player[1] vs player[2]", () => {
    const round = generateFirstRound(PLAYERS_4);
    expect(round.matches[0].p1.id).toBe(0);
    expect(round.matches[0].p2.id).toBe(3);
    expect(round.matches[1].p1.id).toBe(1);
    expect(round.matches[1].p2.id).toBe(2);
  });

  it("generates 4 matches for 8 players", () => {
    const round = generateFirstRound(PLAYERS_8);
    expect(round.matches).toHaveLength(4);
  });

  it("all matches start with no winner", () => {
    const round = generateFirstRound(PLAYERS_4);
    round.matches.forEach(m => {
      expect(m.winner).toBeNull();
      expect(m.score).toBeNull();
    });
  });

  it("round name is Semifinal for 4 players", () => {
    const round = generateFirstRound(PLAYERS_4);
    expect(round.name).toBe("Semifinal");
  });
});

// ─── isRoundComplete ──────────────────────────────────────────────────────────

describe("isRoundComplete", () => {
  it("returns false when no matches have winners", () => {
    const round = generateFirstRound(PLAYERS_4);
    expect(isRoundComplete(round)).toBe(false);
  });

  it("returns false when only some matches have winners", () => {
    const round = generateFirstRound(PLAYERS_4);
    round.matches[0].winner = PLAYERS_4[0];
    expect(isRoundComplete(round)).toBe(false);
  });

  it("returns true when all matches have winners", () => {
    const round = generateFirstRound(PLAYERS_4);
    round.matches[0].winner = PLAYERS_4[0];
    round.matches[1].winner = PLAYERS_4[1];
    expect(isRoundComplete(round)).toBe(true);
  });
});

// ─── generateNextRound ────────────────────────────────────────────────────────

describe("generateNextRound", () => {
  it("returns null when fewer than 2 winners", () => {
    const round = generateFirstRound(PLAYERS_4);
    round.matches[0].winner = PLAYERS_4[0];
    // Only 1 winner
    expect(generateNextRound(round)).toBeNull();
  });

  it("generates a Final round from 2 semifinal winners", () => {
    const round = generateFirstRound(PLAYERS_4);
    round.matches[0].winner = PLAYERS_4[0]; // Alice wins
    round.matches[1].winner = PLAYERS_4[1]; // Bob wins
    const nextRound = generateNextRound(round);
    expect(nextRound).not.toBeNull();
    expect(nextRound!.matches).toHaveLength(1);
    expect(nextRound!.name).toBe("Final");
    expect(nextRound!.matches[0].p1.id).toBe(0); // Alice
    expect(nextRound!.matches[0].p2.id).toBe(1); // Bob
  });

  it("generates Semifinal from 4 quarterfinal winners", () => {
    const round = generateFirstRound(PLAYERS_8);
    round.matches.forEach((m, i) => { m.winner = PLAYERS_8[i]; });
    const nextRound = generateNextRound(round);
    expect(nextRound!.matches).toHaveLength(2);
    expect(nextRound!.name).toBe("Semifinal");
  });
});

// ─── getBracketChampion ───────────────────────────────────────────────────────

describe("getBracketChampion", () => {
  function buildCompletedBracket(): BracketData {
    const round1 = generateFirstRound(PLAYERS_4);
    round1.matches[0].winner = PLAYERS_4[0]; // Alice
    round1.matches[1].winner = PLAYERS_4[1]; // Bob
    const round2 = generateNextRound(round1)!;
    round2.matches[0].winner = PLAYERS_4[0]; // Alice wins final
    return { players: PLAYERS_4, rounds: [round1, round2], currentRoundIdx: 1 };
  }

  it("returns the champion when the final is complete", () => {
    const bracketData = buildCompletedBracket();
    const champion = getBracketChampion(bracketData);
    expect(champion).not.toBeNull();
    expect(champion!.name).toBe("Alice");
  });

  it("returns null when the final is not complete", () => {
    const bracketData = buildCompletedBracket();
    // Remove final winner
    bracketData.rounds[1].matches[0].winner = null;
    expect(getBracketChampion(bracketData)).toBeNull();
  });

  it("returns null when only the first round is complete", () => {
    const round1 = generateFirstRound(PLAYERS_4);
    round1.matches[0].winner = PLAYERS_4[0];
    round1.matches[1].winner = PLAYERS_4[1];
    const bracketData: BracketData = { players: PLAYERS_4, rounds: [round1], currentRoundIdx: 0 };
    // First round has 2 matches, not a single final match
    expect(getBracketChampion(bracketData)).toBeNull();
  });
});
