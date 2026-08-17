import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listTournamentPushTargets: vi.fn(),
  claimTournamentPushDelivery: vi.fn(),
  createUserNotification: vi.fn(),
  removePushSubscriptionById: vi.fn(),
  isScheduledJobTask: vi.fn(),
}));
const webPushMocks = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("web-push", () => ({ default: webPushMocks }));

import { sendTournamentReminders } from "./tournamentReminders";

const now = new Date("2026-08-17T12:00:00.000Z");
const target = {
  tournamentId: 9,
  tournamentName: "Taça da Querência",
  scheduledStartAt: new Date("2026-08-17T13:00:00.000Z"),
  userId: 7,
  subscriptionId: 12,
  endpoint: "https://push.example.test/subscription/12",
  p256dh: "public-key",
  auth: "auth-key",
};

describe("tournament Web Push delivery", () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = "public-key-for-test";
    process.env.VAPID_PRIVATE_KEY = "private-key-for-test";
    process.env.VAPID_SUBJECT = "https://example.test";
    vi.clearAllMocks();
    dbMocks.listTournamentPushTargets.mockResolvedValue([target]);
    dbMocks.claimTournamentPushDelivery.mockResolvedValue(true);
    webPushMocks.sendNotification.mockResolvedValue({});
  });

  it("sends one reminder after reserving its durable receipt", async () => {
    const result = await sendTournamentReminders(now);

    expect(dbMocks.claimTournamentPushDelivery).toHaveBeenCalledWith({
      tournamentId: 9,
      userId: 7,
      subscriptionId: 12,
      reminderKind: "one_hour",
    });
    expect(webPushMocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(dbMocks.createUserNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      kind: "tournament_reminder",
      metadata: { tournamentId: 9, reminderKind: "one_hour" },
    }));
    expect(result).toMatchObject({ checked: 1, reserved: 1, sent: 1, errors: 0 });
  });

  it("does not send again when the idempotency receipt already exists", async () => {
    dbMocks.claimTournamentPushDelivery.mockResolvedValue(false);

    const result = await sendTournamentReminders(now);

    expect(webPushMocks.sendNotification).not.toHaveBeenCalled();
    expect(dbMocks.createUserNotification).not.toHaveBeenCalled();
    expect(result).toMatchObject({ checked: 1, reserved: 0, sent: 0 });
  });

  it("removes only the subscription rejected as expired by the push service", async () => {
    webPushMocks.sendNotification.mockRejectedValue({ statusCode: 410 });

    const result = await sendTournamentReminders(now);

    expect(dbMocks.removePushSubscriptionById).toHaveBeenCalledWith(12);
    expect(result).toMatchObject({ sent: 0, expiredSubscriptionsRemoved: 1, errors: 0 });
  });
});
