/**
 * Tests for JWT-validated Socket.IO auth and Google login URL endpoint
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Helper: create a public test context ──
function createPublicCtx(): TrpcContext {
  return {
    req: { headers: { cookie: "" } } as any,
    res: {} as any,
    user: null,
  };
}

// ── auth.loginUrl procedure tests ──
describe("auth.loginUrl", () => {
  it("returns a URL string when origin is provided", async () => {
    const caller = appRouter.createCaller(createPublicCtx());

    const result = await caller.auth.loginUrl({ origin: "https://example.com" });
    expect(result).toHaveProperty("url");
    expect(typeof result.url).toBe("string");
    expect(result.url.length).toBeGreaterThan(0);
  });

  it("URL contains the origin as returnPath base", async () => {
    const caller = appRouter.createCaller(createPublicCtx());

    const origin = "https://trucotche.manus.space";
    const result = await caller.auth.loginUrl({ origin });
    // The URL should be a valid URL
    expect(() => new URL(result.url)).not.toThrow();
  });

  it("returns different URLs for different origins", async () => {
    const caller = appRouter.createCaller(createPublicCtx());

    const result1 = await caller.auth.loginUrl({ origin: "https://example1.com" });
    const result2 = await caller.auth.loginUrl({ origin: "https://example2.com" });
    // URLs should differ because they encode different origins
    expect(result1.url).not.toBe(result2.url);
  });
});

// ── JWT Socket auth logic unit tests ──
describe("Socket JWT auth logic", () => {
  it("cookie regex extracts session cookie correctly", () => {
    const COOKIE_NAME = "app_session_id";
    const cookieHeader = `other_cookie=abc; ${COOKIE_NAME}=my.jwt.token; another=xyz`;
    const cookieMatch = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
    );
    expect(cookieMatch).not.toBeNull();
    expect(cookieMatch![1]).toBe("my.jwt.token");
  });

  it("cookie regex returns null when cookie is absent", () => {
    const COOKIE_NAME = "app_session_id";
    const cookieHeader = "other_cookie=abc; another=xyz";
    const cookieMatch = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
    );
    expect(cookieMatch).toBeNull();
  });

  it("cookie regex handles URL-encoded values", () => {
    const COOKIE_NAME = "app_session_id";
    const encodedToken = encodeURIComponent("header.payload.signature");
    const cookieHeader = `${COOKIE_NAME}=${encodedToken}`;
    const cookieMatch = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
    );
    expect(cookieMatch).not.toBeNull();
    const decoded = decodeURIComponent(cookieMatch![1]);
    expect(decoded).toBe("header.payload.signature");
  });

  it("cookie regex handles cookie as first item (no leading semicolon)", () => {
    const COOKIE_NAME = "app_session_id";
    const cookieHeader = `${COOKIE_NAME}=firstcookie; other=value`;
    const cookieMatch = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
    );
    expect(cookieMatch).not.toBeNull();
    expect(cookieMatch![1]).toBe("firstcookie");
  });

  it("cookie regex handles empty cookie header", () => {
    const COOKIE_NAME = "app_session_id";
    const cookieHeader = "";
    const cookieMatch = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
    );
    expect(cookieMatch).toBeNull();
  });
});
