/**
 * Tests for online.tournamentBracket endpoint and getTournamentBracket helper.
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getTournamentBracket } from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(userId = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `user-${userId}`,
    email: `user${userId}@example.com`,
    name: `User ${userId}`,
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("online.tournamentBracket", () => {
  it("is a public procedure — accessible without auth", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    // Non-existent tournament should return null, not throw
    const result = await caller.online.tournamentBracket({ tournamentId: 999999 });
    expect(result).toBeNull();
  });

  it("also accessible when authenticated", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.online.tournamentBracket({ tournamentId: 999999 });
    expect(result).toBeNull();
  });

  it("rejects invalid tournamentId (zero)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.online.tournamentBracket({ tournamentId: 0 })
    ).rejects.toThrow();
  });

  it("rejects invalid tournamentId (negative)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.online.tournamentBracket({ tournamentId: -1 })
    ).rejects.toThrow();
  });

  it("rejects non-integer tournamentId", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.online.tournamentBracket({ tournamentId: 1.5 })
    ).rejects.toThrow();
  });
});

describe("getTournamentBracket helper", () => {
  it("returns null for non-existent tournament", async () => {
    const result = await getTournamentBracket(999999);
    expect(result).toBeNull();
  });

  it("returns null for tournament ID 0", async () => {
    // DB query with id=0 should return empty rows → null
    const result = await getTournamentBracket(0);
    expect(result).toBeNull();
  });
});

describe("BracketData structure validation", () => {
  it("valid bracket data has required fields when tournament exists", async () => {
    // Use a real tournament if one exists, otherwise skip gracefully
    const result = await getTournamentBracket(1);
    if (result === null) {
      // No tournament with ID 1 — that's fine
      expect(result).toBeNull();
      return;
    }

    // If a tournament exists, validate its shape
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("maxPlayers");
    expect(result).toHaveProperty("currentRound");
    expect(result).toHaveProperty("totalRounds");
    expect(result).toHaveProperty("players");
    expect(result).toHaveProperty("rounds");
    expect(result).toHaveProperty("currentRoundIndex");

    expect(Array.isArray(result.players)).toBe(true);
    expect(Array.isArray(result.rounds)).toBe(true);
    expect(typeof result.currentRoundIndex).toBe("number");

    // Validate player shape
    for (const player of result.players) {
      expect(player).toHaveProperty("userId");
      expect(player).toHaveProperty("userName");
      expect(player).toHaveProperty("seed");
      expect(player).toHaveProperty("eliminated");
      expect(typeof player.userId).toBe("number");
      expect(typeof player.userName).toBe("string");
    }

    // Validate rounds structure
    for (const round of result.rounds) {
      expect(Array.isArray(round)).toBe(true);
      for (const match of round) {
        expect(match).toHaveProperty("round");
        expect(match).toHaveProperty("matchIndex");
        expect(match).toHaveProperty("p1UserId");
        expect(match).toHaveProperty("p2UserId");
        expect(match).toHaveProperty("p1Name");
        expect(match).toHaveProperty("p2Name");
        expect(typeof match.round).toBe("number");
        expect(typeof match.matchIndex).toBe("number");
        expect(typeof match.p1Name).toBe("string");
        expect(typeof match.p2Name).toBe("string");
      }
    }
  });
});
