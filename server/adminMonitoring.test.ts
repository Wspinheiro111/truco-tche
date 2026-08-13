/**
 * Tests for admin.monitoring endpoint and getAdminMonitoring helper.
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(userId = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `admin-user-${userId}`,
    email: `admin${userId}@example.com`,
    name: `Admin User ${userId}`,
    loginMethod: "manus",
    role: "admin",
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

function createUserContext(userId = 2): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `regular-user-${userId}`,
    email: `user${userId}@example.com`,
    name: `Regular User ${userId}`,
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

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("admin.monitoring", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.monitoring()).rejects.toThrow();
  });

  it("rejects non-admin users", async () => {
    const ctx = createUserContext(1);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.monitoring()).rejects.toThrow();
  });

  it("returns monitoring data for admin users", async () => {
    const ctx = createAdminContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.monitoring();

    // Validate shape of response
    expect(result).toHaveProperty("activeRooms");
    expect(result).toHaveProperty("onlinePlayersCount");
    expect(result).toHaveProperty("recentOnlineMatches");
    expect(result).toHaveProperty("activeTournaments");
    expect(result).toHaveProperty("todayOnlineMatches");
    expect(result).toHaveProperty("totalOnlineMatches");

    // Validate types
    expect(Array.isArray(result.activeRooms)).toBe(true);
    expect(typeof result.onlinePlayersCount).toBe("number");
    expect(Array.isArray(result.recentOnlineMatches)).toBe(true);
    expect(Array.isArray(result.activeTournaments)).toBe(true);
    expect(typeof result.todayOnlineMatches).toBe("number");
    expect(typeof result.totalOnlineMatches).toBe("number");

    // Validate numeric constraints
    expect(result.onlinePlayersCount).toBeGreaterThanOrEqual(0);
    expect(result.todayOnlineMatches).toBeGreaterThanOrEqual(0);
    expect(result.totalOnlineMatches).toBeGreaterThanOrEqual(0);

    // Validate activeRooms structure if any exist
    for (const room of result.activeRooms) {
      expect(room).toHaveProperty("id");
      expect(room).toHaveProperty("code");
      expect(room).toHaveProperty("hostName");
      expect(room).toHaveProperty("status");
      expect(["waiting", "playing"]).toContain(room.status);
    }

    // Validate recentOnlineMatches structure if any exist
    for (const match of result.recentOnlineMatches) {
      expect(match).toHaveProperty("id");
      expect(match).toHaveProperty("player1Name");
      expect(match).toHaveProperty("player2Name");
      expect(match).toHaveProperty("scoreP1");
      expect(match).toHaveProperty("scoreP2");
    }

    // Validate activeTournaments structure if any exist
    for (const tournament of result.activeTournaments) {
      expect(tournament).toHaveProperty("id");
      expect(tournament).toHaveProperty("name");
      expect(tournament).toHaveProperty("status");
      expect(["registering", "active"]).toContain(tournament.status);
      expect(tournament).toHaveProperty("currentPlayers");
      expect(tournament).toHaveProperty("maxPlayers");
    }
  });

  it("returns at most 50 active rooms", async () => {
    const ctx = createAdminContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.monitoring();
    expect(result.activeRooms.length).toBeLessThanOrEqual(50);
  });

  it("returns at most 20 recent matches", async () => {
    const ctx = createAdminContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.monitoring();
    expect(result.recentOnlineMatches.length).toBeLessThanOrEqual(20);
  });
});
