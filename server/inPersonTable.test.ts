import { describe, expect, it } from "vitest";
import { createInPersonInviteToken, getInPersonModeConfig, hashInPersonInviteToken, isInPersonInviteExpired } from "./db";

describe("Mesa Presencial invite", () => {
  it("generates an opaque token and stores only a deterministic SHA-256 hash", () => {
    const token = createInPersonInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    expect(hashInPersonInviteToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInPersonInviteToken(token)).toBe(hashInPersonInviteToken(token));
    expect(hashInPersonInviteToken(`${token}x`)).not.toBe(hashInPersonInviteToken(token));
  });

  it("rejects invitations at or after their expiry time", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    expect(isInPersonInviteExpired("2026-08-17T11:59:59.999Z", now)).toBe(true);
    expect(isInPersonInviteExpired("2026-08-17T12:00:00.000Z", now)).toBe(true);
    expect(isInPersonInviteExpired("2026-08-17T12:00:00.001Z", now)).toBe(false);
  });

  it("defines the exact number of QR seats for mano a mano, duplas and trios", () => {
    expect(getInPersonModeConfig("1v1")).toMatchObject({ maxPlayers: 2, teamSize: 1 });
    expect(getInPersonModeConfig("2v2")).toMatchObject({ maxPlayers: 4, teamSize: 2 });
    expect(getInPersonModeConfig("3v3")).toMatchObject({ maxPlayers: 6, teamSize: 3 });
  });
});
