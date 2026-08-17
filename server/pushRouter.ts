import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { listPushSubscriptionsForUser, removePushSubscription, upsertPushSubscription } from "./db";

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  p256dh: z.string().trim().min(16).max(512),
  auth: z.string().trim().min(16).max(512),
  userAgent: z.string().trim().max(512).optional(),
});

export const pushRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const subscriptions = await listPushSubscriptionsForUser(ctx.user.id);
    return { enabled: subscriptions.length > 0, deviceCount: subscriptions.length };
  }),
  subscribe: protectedProcedure
    .input(pushSubscriptionSchema)
    .mutation(async ({ ctx, input }) => {
      await upsertPushSubscription(ctx.user.id, input);
      return { success: true } as const;
    }),
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url().max(4096) }))
    .mutation(async ({ ctx, input }) => ({
      success: await removePushSubscription(ctx.user.id, input.endpoint),
    })),
});
