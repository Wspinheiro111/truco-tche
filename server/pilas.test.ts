import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId = 1, role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `test${userId}@example.com`,
    name: `Test User ${userId}`,
    loginMethod: "manus",
    role,
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

describe("mercadopago credential validation", () => {
  it.skipIf(!process.env.MERCADO_PAGO_ACCESS_TOKEN)("validates that MERCADO_PAGO_ACCESS_TOKEN is set and can list payment methods", async () => {
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    expect(token).toBeTruthy();
    expect(token!.startsWith("APP_USR-")).toBe(true);

    const res = await fetch("https://api.mercadopago.com/v1/payment_methods", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const methods = await res.json();
    expect(Array.isArray(methods)).toBe(true);
    expect(methods.length).toBeGreaterThan(0);

    const pix = methods.find((m: any) => m.id === "pix");
    expect(pix).toBeTruthy();
    expect(pix.status).toBe("active");
  });
});

describe("pilas", () => {
  describe("pilas.balance", () => {
    it("returns balance for an authenticated user", async () => {
      // Use userId=1 (owner) which is guaranteed to exist in the DB
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.pilas.balance();
      expect(result).toHaveProperty("balance");
      expect(typeof result.balance).toBe("number");
      expect(result.balance).toBeGreaterThanOrEqual(0);
    });
  });

  describe("pilas.packages", () => {
    it("returns an array of packages (public)", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);
      const result = await caller.pilas.packages();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("pilas.transactions", () => {
    it("returns transaction history for authenticated user", async () => {
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.pilas.transactions();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("pilas.createPixPayment", () => {
    it("rejects unauthenticated users", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.pilas.createPixPayment({ packageId: 1 })
      ).rejects.toThrow();
    });

    it("rejects invalid package ID", async () => {
      const ctx = createAuthContext(99999);
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.pilas.createPixPayment({ packageId: 999999 })
      ).rejects.toThrow();
    });
  });

  describe("pilas.checkPaymentStatus", () => {
    it("rejects unauthenticated users", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.pilas.checkPaymentStatus({ paymentId: "123" })
      ).rejects.toThrow();
    });

    it("returns not found for non-existent payment", async () => {
      const ctx = createAuthContext(99999);
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.pilas.checkPaymentStatus({ paymentId: "nonexistent" })
      ).rejects.toThrow();
    });
  });

  describe("pilas.adminListPackages", () => {
    it("rejects non-admin users", async () => {
      const ctx = createAuthContext(99999, "user");
      const caller = appRouter.createCaller(ctx);
      await expect(caller.pilas.adminListPackages()).rejects.toThrow();
    });

    it("returns packages for admin users", async () => {
      const ctx = createAuthContext(1, "admin");
      const caller = appRouter.createCaller(ctx);
      const result = await caller.pilas.adminListPackages();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("pilas.adminCreatePackage", () => {
    it("rejects non-admin users", async () => {
      const ctx = createAuthContext(99999, "user");
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.pilas.adminCreatePackage({
          name: "Test Package",
          pilas: 10,
          priceCents: 1000,
        })
      ).rejects.toThrow();
    });
  });
});
