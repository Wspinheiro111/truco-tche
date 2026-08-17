import type { Request, Response } from "express";
import webpush from "web-push";
import {
  claimTournamentPushDelivery,
  isScheduledJobTask,
  listTournamentPushTargets,
  removePushSubscriptionById,
} from "./db";
import { sdk } from "./_core/sdk";
import { HttpError } from "@shared/_core/errors";

export const TOURNAMENT_REMINDER_JOB_NAME = "tournament-reminders";
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const DELIVERY_WINDOW_MS = 8 * 60 * 1000;

export type ReminderKind = "one_hour" | "fifteen_minutes";

export function getTournamentReminderKind(timeUntilStartMs: number): ReminderKind | null {
  if (Math.abs(timeUntilStartMs - ONE_HOUR_MS) <= DELIVERY_WINDOW_MS) return "one_hour";
  if (Math.abs(timeUntilStartMs - FIFTEEN_MINUTES_MS) <= DELIVERY_WINDOW_MS) return "fifteen_minutes";
  return null;
}

export function buildTournamentReminderPayload(input: {
  tournamentId: number;
  tournamentName: string;
  scheduledStartAt: Date;
  reminderKind: ReminderKind;
}) {
  const minutes = input.reminderKind === "one_hour" ? 60 : 15;
  return JSON.stringify({
    title: `🏆 ${input.tournamentName}`,
    body: `Faltam ${minutes} minutos para o horário previsto. Prepare as cartas, tchê!`,
    tag: `tournament-${input.tournamentId}-${input.reminderKind}`,
    url: `/tournament/${input.tournamentId}`,
  });
}

export function scheduledCallbackErrorStatus(error: unknown): number {
  return error instanceof HttpError ? error.statusCode : 500;
}

function configureWebPush(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID credentials are not configured");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendTournamentReminders(now = new Date()) {
  configureWebPush();
  const targets = await listTournamentPushTargets(now);
  const result = { checked: targets.length, reserved: 0, sent: 0, expiredSubscriptionsRemoved: 0, errors: 0 };

  for (const target of targets) {
    const reminderKind = getTournamentReminderKind(target.scheduledStartAt.getTime() - now.getTime());
    if (!reminderKind) continue;
    const claimed = await claimTournamentPushDelivery({
      tournamentId: target.tournamentId,
      userId: target.userId,
      subscriptionId: target.subscriptionId,
      reminderKind,
    });
    if (!claimed) continue;
    result.reserved += 1;

    try {
      await webpush.sendNotification({
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      }, buildTournamentReminderPayload({
        tournamentId: target.tournamentId,
        tournamentName: target.tournamentName,
        scheduledStartAt: target.scheduledStartAt,
        reminderKind,
      }), { TTL: 60 * 60, urgency: "high" });
      result.sent += 1;
    } catch (error: unknown) {
      const statusCode = Number((error as { statusCode?: number }).statusCode ?? 0);
      if (statusCode === 404 || statusCode === 410) {
        await removePushSubscriptionById(target.subscriptionId);
        result.expiredSubscriptionsRemoved += 1;
      } else {
        console.warn("[Tournament reminders] Delivery failed", { tournamentId: target.tournamentId, subscriptionId: target.subscriptionId, statusCode });
        result.errors += 1;
      }
    }
  }
  return result;
}

export async function tournamentRemindersHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      return res.status(403).json({ error: "cron-only" });
    }
    if (!await isScheduledJobTask(TOURNAMENT_REMINDER_JOB_NAME, user.taskUid)) {
      return res.status(403).json({ error: "unrecognized-cron" });
    }
    return res.json({ ok: true, ...(await sendTournamentReminders()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Tournament reminders] Scheduled execution failed", error);
    return res.status(scheduledCallbackErrorStatus(error)).json({
      error: message,
      context: { url: req.originalUrl },
      timestamp: new Date().toISOString(),
    });
  }
}
