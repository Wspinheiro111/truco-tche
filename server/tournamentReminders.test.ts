import { describe, expect, it } from "vitest";
import { buildTournamentReminderPayload, getTournamentReminderKind, scheduledCallbackErrorStatus } from "./tournamentReminders";
import { ForbiddenError } from "@shared/_core/errors";

describe("tournament reminder schedule", () => {
  it("selects only the one-hour and fifteen-minute delivery windows", () => {
    expect(getTournamentReminderKind(60 * 60 * 1000)).toBe("one_hour");
    expect(getTournamentReminderKind(15 * 60 * 1000)).toBe("fifteen_minutes");
    expect(getTournamentReminderKind(35 * 60 * 1000)).toBeNull();
  });

  it("creates a visible, tournament-specific push payload", () => {
    const payload = JSON.parse(buildTournamentReminderPayload({
      tournamentId: 42,
      tournamentName: "Taça do Pago",
      scheduledStartAt: new Date("2026-08-18T18:00:00.000Z"),
      reminderKind: "fifteen_minutes",
    }));

    expect(payload.title).toContain("Taça do Pago");
    expect(payload.body).toContain("15 minutos");
    expect(payload.tag).toBe("tournament-42-fifteen_minutes");
    expect(payload.url).toBe("/tournament/42");
  });

  it("preserves authorization failures instead of converting them into server errors", () => {
    expect(scheduledCallbackErrorStatus(ForbiddenError("cron-only"))).toBe(403);
    expect(scheduledCallbackErrorStatus(new Error("unexpected"))).toBe(500);
  });
});
