import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";

export const friendsRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => ({
    friends: await db.listFriends(ctx.user.id),
    incoming: await db.listIncomingFriendRequests(ctx.user.id),
    invites: await db.listPendingFriendGameInvites(ctx.user.id),
  })),
  search: protectedProcedure.input(z.object({ query: z.string().trim().min(2).max(80) })).query(async ({ ctx, input }) =>
    db.searchFriendCandidates(ctx.user.id, input.query)),
  sendRequest: protectedProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) =>
    db.sendFriendRequest(ctx.user.id, input.userId)),
  respond: protectedProcedure.input(z.object({ friendshipId: z.number().int().positive(), accept: z.boolean() })).mutation(async ({ ctx, input }) => {
    const changed = await db.respondToFriendRequest(ctx.user.id, input.friendshipId, input.accept);
    if (!changed) throw new Error("Solicitação indisponível");
    return { success: true };
  }),
  remove: protectedProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => ({ success: await db.removeFriend(ctx.user.id, input.userId) })),
  claimInvite: protectedProcedure.input(z.object({ roomCode: z.string().min(4).max(10) })).mutation(async ({ ctx, input }) => ({ success: await db.claimFriendGameInvite(ctx.user.id, input.roomCode.toUpperCase()) })),
});
