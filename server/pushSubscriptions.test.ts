import { describe, expect, it } from "vitest";
import { hashPushEndpoint } from "./db";

describe("Web Push subscription identity", () => {
  it("derives a stable SHA-256 identifier without preserving the endpoint", () => {
    const endpoint = "https://push.example.test/subscription/device-123";
    const hash = hashPushEndpoint(endpoint);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashPushEndpoint(endpoint));
    expect(hash).not.toContain("device-123");
  });
});
