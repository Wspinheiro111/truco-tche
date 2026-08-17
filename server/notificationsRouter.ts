import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { listUserNotifications, markAllUserNotificationsRead, markUserNotificationRead } from "./db";

export function parseNotificationMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const notifications = await listUserNotifications(ctx.user.id, input?.limit ?? 50);
      return {
        unreadCount: notifications.filter(notification => !notification.readAt).length,
        notifications: notifications.map(notification => ({
          ...notification,
          metadata: parseNotificationMetadata(notification.metadataJson),
        })),
      };
    }),
  markRead: protectedProcedure
    .input(z.object({ notificationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => ({
      success: await markUserNotificationRead(ctx.user.id, input.notificationId),
    })),
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => ({
    updated: await markAllUserNotificationsRead(ctx.user.id),
  })),
});
