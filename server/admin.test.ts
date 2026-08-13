import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 999,
    openId: "admin-test",
    email: "gerentewilliam.pinheiro@gmail.com",
    name: "Admin Test",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 888,
    openId: "user-test",
    email: "user@example.com",
    name: "Regular User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("sponsor.listActive (public)", () => {
  it("returns an array of active sponsors without auth", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sponsor.listActive();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("sponsor admin procedures", () => {
  it("rejects non-admin users from listAll", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.sponsor.listAll()).rejects.toThrow();
  });

  it("rejects unauthenticated users from listAll", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.sponsor.listAll()).rejects.toThrow();
  });

  it("allows admin to listAll sponsors", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sponsor.listAll();
    expect(Array.isArray(result)).toBe(true);
  });

  it("rejects create with invalid data", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.sponsor.create({
        name: "",
        mediaUrl: "not-a-url",
        mediaType: "image",
        position: "bottom",
        active: 1,
        displayOrder: 0,
        slideDuration: 8,
      })
    ).rejects.toThrow();
  });
});

describe("admin procedures", () => {
  it("rejects non-admin users from matchStats", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.matchStats()).rejects.toThrow();
  });

  it("rejects unauthenticated users from matchStats", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.matchStats()).rejects.toThrow();
  });

  it("allows admin to get matchStats", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.matchStats();
    expect(result).toHaveProperty("daily");
    expect(result).toHaveProperty("weekly");
    expect(result).toHaveProperty("monthly");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("dailyChart");
    expect(typeof result.daily).toBe("number");
    expect(typeof result.weekly).toBe("number");
    expect(typeof result.monthly).toBe("number");
    expect(typeof result.total).toBe("number");
    expect(Array.isArray(result.dailyChart)).toBe(true);
  });

  it("allows admin to get topPlayers", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.topPlayers({ limit: 5 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("allows admin to listUsers", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.listUsers({ limit: 10, offset: 0 });
    expect(result).toHaveProperty("users");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.users)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("allows admin to searchUsers", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.searchUsers({ query: "test" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("prevents admin from deleting themselves", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.admin.deleteUser({ userId: 999 })
    ).rejects.toThrow("Você não pode excluir sua própria conta");
  });

  it("rejects non-admin from deleteUser", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.admin.deleteUser({ userId: 1 })
    ).rejects.toThrow();
  });
});
