import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import {
  listUsersWithStats,
  searchUserByEmail,
  deleteUserById,
  getMatchStats,
  getTopPlayers,
  getUserById,
  getAdminMonitoring,
} from "./db";

export const adminRouter = router({
  /**
   * Dashboard stats: match counts (daily/weekly/monthly) + chart data.
   */
  matchStats: adminProcedure.query(async () => {
    return getMatchStats();
  }),

  /**
   * Top players by number of matches played.
   */
  topPlayers: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }).optional())
    .query(async ({ input }) => {
      return getTopPlayers(input?.limit ?? 10);
    }),

  /**
   * List all users with stats (paginated).
   */
  listUsers: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      return listUsersWithStats(input?.limit ?? 50, input?.offset ?? 0);
    }),

  /**
   * Search users by email/login.
   */
  searchUsers: adminProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      return searchUserByEmail(input.query);
    }),

  /**
   * Delete a user by ID (with confirmation).
   */
  deleteUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // Prevent admin from deleting themselves
      if (input.userId === ctx.user.id) {
        throw new Error("Você não pode excluir sua própria conta.");
      }
      const user = await getUserById(input.userId);
      if (!user) throw new Error("Usuário não encontrado.");
      if (user.role === "admin") throw new Error("Não é possível excluir outro administrador.");
      await deleteUserById(input.userId);
      return { success: true, deletedUser: user.name || user.email };
    }),

  /**
   * Real-time monitoring: active rooms, online players, recent online matches,
   * active tournaments, and aggregate counters.
   */
  monitoring: adminProcedure.query(async () => {
    return getAdminMonitoring();
  }),
});
