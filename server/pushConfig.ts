import type { Request, Response } from "express";

export function getPublicPushConfig() {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  if (!vapidPublicKey || vapidPublicKey.length < 40) {
    throw new Error("VAPID_PUBLIC_KEY is not configured");
  }
  return { vapidPublicKey };
}

export function pushConfigHandler(_req: Request, res: Response) {
  try {
    res.status(200).json(getPublicPushConfig());
  } catch {
    res.status(503).json({ error: "Push notifications are not configured" });
  }
}
