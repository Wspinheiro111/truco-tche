import { z } from "zod";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import {
  getPilasBalance,
  getPilasTransactions,
  listPilasPackages,
  getPilasPackageById,
  createPixPaymentRecord,
  getPendingPixPayments,
  getPixPaymentByMpId,
  updatePixPaymentStatus,
  listAllPilasPackages,
  createPilasPackage,
  updatePilasPackage,
  deletePilasPackage,
  getUserPurchases,
  userOwnsItem,
  purchaseShopItem,
} from "./db";
import { createPixPayment, getPaymentStatus } from "./mercadopago";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";

export const pilasRouter = router({
  /**
   * Get the current user's pilas balance.
   */
  balance: protectedProcedure.query(async ({ ctx }) => {
    const balance = await getPilasBalance(ctx.user.id);
    return { balance };
  }),

  /**
   * Get the current user's pilas transaction history.
   */
  transactions: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getPilasTransactions(ctx.user.id, input?.limit ?? 50);
    }),

  /**
   * List available pilas packages for purchase.
   */
  packages: publicProcedure.query(async () => {
    return listPilasPackages();
  }),

  /**
   * Create a Pix payment to purchase a pilas package.
   * Returns QR code data for the user to scan/copy.
   */
  createPixPayment: protectedProcedure
    .input(z.object({ packageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await getPilasPackageById(input.packageId);
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pacote não encontrado" });
      }
      if (!pkg.active) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pacote indisponível" });
      }

      const amountBRL = pkg.priceCents / 100;
      const totalPilas = pkg.pilas + pkg.bonusPilas;
      const idempotencyKey = randomUUID();

      const userEmail = ctx.user.email || `user${ctx.user.id}@trucotche.com`;

      try {
        const mpResult = await createPixPayment({
          amountBRL,
          description: `Truco Tchê - ${pkg.name} (${totalPilas} pilas)`,
          payerEmail: userEmail,
          idempotencyKey,
          expirationMinutes: 30,
        });

        // Save payment record
        await createPixPaymentRecord({
          userId: ctx.user.id,
          packageId: pkg.id,
          mpPaymentId: mpResult.paymentId,
          amountCents: pkg.priceCents,
          pilasToCredit: totalPilas,
          qrCode: mpResult.qrCode,
          qrCodeBase64: mpResult.qrCodeBase64,
          ticketUrl: mpResult.ticketUrl,
          expiresAt: mpResult.expiresAt,
        });

        return {
          paymentId: mpResult.paymentId,
          qrCode: mpResult.qrCode,
          qrCodeBase64: mpResult.qrCodeBase64,
          ticketUrl: mpResult.ticketUrl,
          amountBRL,
          pilas: totalPilas,
          expiresAt: mpResult.expiresAt.toISOString(),
        };
      } catch (error: any) {
        console.error("[Pilas] createPixPayment error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao criar pagamento Pix. Tente novamente.",
        });
      }
    }),

  /**
   * Check the status of a pending Pix payment.
   * Polls Mercado Pago for updates and credits pilas if approved.
   */
  checkPaymentStatus: protectedProcedure
    .input(z.object({ paymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const payment = await getPixPaymentByMpId(input.paymentId);
      if (!payment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pagamento não encontrado" });
      }
      if (payment.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      }

      // If already approved, return immediately
      if (payment.status === 'approved') {
        return { status: 'approved', credited: true, balance: await getPilasBalance(ctx.user.id) };
      }

      // Check with Mercado Pago
      try {
        const mpStatus = await getPaymentStatus(input.paymentId);
        const credited = await updatePixPaymentStatus(input.paymentId, mpStatus.status);

        return {
          status: mpStatus.status,
          credited,
          balance: mpStatus.status === 'approved' ? await getPilasBalance(ctx.user.id) : undefined,
        };
      } catch (error: any) {
        console.error("[Pilas] checkPaymentStatus error:", error);
        return { status: payment.status, credited: false };
      }
    }),

  /**
   * Get pending payments for the current user.
   */
  pendingPayments: protectedProcedure.query(async ({ ctx }) => {
    return getPendingPixPayments(ctx.user.id);
  }),

  // ─── Shop Item Purchases ─────────────────────────────────────────────────

  /**
   * Get all shop items the current user has purchased with Pilas.
   */
  myPurchases: protectedProcedure.query(async ({ ctx }) => {
    return getUserPurchases(ctx.user.id);
  }),

  /**
   * Check if the current user owns a specific shop item.
   */
  ownsItem: protectedProcedure
    .input(z.object({ category: z.string(), itemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const owns = await userOwnsItem(ctx.user.id, input.category, input.itemId);
      return { owns };
    }),

  /**
   * Purchase a shop item (skin, theme, avatar) using Pilas.
   * Debits pilas and records the purchase.
   */
  buyShopItem: protectedProcedure
    .input(z.object({
      category: z.enum(['skins', 'themes', 'avatars']),
      itemId: z.string().min(1),
      pricePilas: z.number().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const newBalance = await purchaseShopItem(
          ctx.user.id,
          input.category,
          input.itemId,
          input.pricePilas,
        );
        return { success: true, balance: newBalance };
      } catch (error: any) {
        if (error.message.includes('já possui')) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        if (error.message.includes('insuficiente')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Erro ao processar compra' });
      }
    }),

  // ─── Admin endpoints ─────────────────────────────────────────────────────

  /**
   * List all packages (admin only).
   */
  adminListPackages: adminProcedure.query(async () => {
    return listAllPilasPackages();
  }),

  /**
   * Create a package (admin only).
   */
  adminCreatePackage: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      pilas: z.number().min(1),
      priceCents: z.number().min(100),
      bonusPilas: z.number().min(0).optional(),
      badge: z.string().optional(),
      displayOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      await createPilasPackage(input);
      return { success: true };
    }),

  /**
   * Update a package (admin only).
   */
  adminUpdatePackage: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      pilas: z.number().optional(),
      priceCents: z.number().optional(),
      bonusPilas: z.number().optional(),
      badge: z.string().nullable().optional(),
      active: z.boolean().optional(),
      displayOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updatePilasPackage(id, data as any);
      return { success: true };
    }),

  /**
   * Delete a package (admin only).
   */
  adminDeletePackage: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deletePilasPackage(input.id);
      return { success: true };
    }),
});
