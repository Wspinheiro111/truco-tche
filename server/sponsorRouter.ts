import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "./_core/trpc";
import {
  listAllSponsors,
  listActiveSponsors,
  getSponsorById,
  createSponsor,
  updateSponsor,
  deleteSponsor,
  recordSponsorEvent,
  getSponsorMetrics,
  getSponsorDailyMetrics,
  getTodayImpressions,
} from "./db";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { notifyOwner } from "./_core/notification";

const sponsorUrl = z.string().url().refine(value => new URL(value).protocol === "https:", "URL de patrocinador deve usar HTTPS");

export const sponsorRouter = router({
  /**
   * Public: list active sponsors for game banners.
   */
  listActive: publicProcedure.query(async () => {
    const all = await listActiveSponsors();
    const today = new Date().toISOString().slice(0, 10);
    return all.filter(s => {
      if (s.startDate && s.startDate > today) return false;
      if (s.endDate && s.endDate < today) return false;
      return true;
    });
  }),

  /**
   * Admin: list all sponsors (including inactive).
   */
  listAll: adminProcedure.query(async () => {
    return listAllSponsors();
  }),

  /**
   * Admin: get a single sponsor by ID.
   */
  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getSponsorById(input.id);
    }),

  /**
   * Admin: upload sponsor media (image or video) to S3.
   * Accepts base64-encoded file data.
   */
  uploadMedia: adminProcedure
    .input(
      z.object({
        fileName: z.string(),
        fileData: z.string(), // base64
        contentType: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileData, "base64");
      const ext = input.fileName.split(".").pop() || "bin";
      const key = `sponsors/${nanoid(12)}.${ext}`;
      const { url } = await storagePut(key, buffer, input.contentType);
      return { url };
    }),

  /**
   * Admin: create a new sponsor.
   */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        mediaUrl: sponsorUrl,
        mediaType: z.enum(["image", "video"]).default("image"),
        linkUrl: sponsorUrl.nullable().optional(),
        position: z.enum(["top", "bottom"]).default("bottom"),
        active: z.boolean().default(true),
        displayOrder: z.number().min(0).default(0),
        slideDuration: z.number().min(3).max(60).default(8),
        dailyImpressionGoal: z.number().min(0).default(0),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await createSponsor(input);
      return { success: true };
    }),

  /**
   * Admin: update an existing sponsor.
   */
  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(200).optional(),
        mediaUrl: sponsorUrl.optional(),
        mediaType: z.enum(["image", "video"]).optional(),
        linkUrl: sponsorUrl.nullable().optional(),
        position: z.enum(["top", "bottom"]).optional(),
        active: z.boolean().optional(),
        displayOrder: z.number().min(0).optional(),
        slideDuration: z.number().min(3).max(60).optional(),
        dailyImpressionGoal: z.number().min(0).optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateSponsor(id, data);
      return { success: true };
    }),

  /**
   * Admin: delete a sponsor.
   */
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteSponsor(input.id);
      return { success: true };
    }),

  /**
   * Public: track a sponsor event (impression or click).
   * Called from the frontend when a banner is shown or clicked.
   */
  trackEvent: publicProcedure
    .input(
      z.object({
        sponsorId: z.number(),
        eventType: z.enum(["impression", "click"]),
      })
    )
    .mutation(async ({ input }) => {
      await recordSponsorEvent(input.sponsorId, input.eventType);
      // Check daily impression goal and notify admin
      if (input.eventType === 'impression') {
        try {
          const sponsor = await getSponsorById(input.sponsorId);
          if (sponsor && sponsor.dailyImpressionGoal > 0) {
            const todayCount = await getTodayImpressions(input.sponsorId);
            if (todayCount === sponsor.dailyImpressionGoal) {
              await notifyOwner({
                title: `Meta atingida: ${sponsor.name}`,
                content: `O patrocinador "${sponsor.name}" atingiu a meta de ${sponsor.dailyImpressionGoal} impress\u00f5es di\u00e1rias hoje!`,
              });
            }
          }
        } catch (_) { /* non-critical */ }
      }
      return { success: true };
    }),

  /**
   * Admin: get aggregated metrics for all sponsors.
   */
  metrics: adminProcedure
    .input(
      z.object({
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const rows = await getSponsorMetrics(input?.fromDate, input?.toDate);
      return rows;
    }),

  /**
   * Admin: get daily breakdown for a specific sponsor.
   */
  dailyMetrics: adminProcedure
    .input(
      z.object({
        sponsorId: z.number(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const rows = await getSponsorDailyMetrics(input.sponsorId, input.fromDate, input.toDate);
      return rows;
    }),

  /**
   * Admin: reorder sponsors (batch update displayOrder).
   */
  reorder: adminProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            id: z.number(),
            displayOrder: z.number(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      for (const item of input.items) {
        await updateSponsor(item.id, { displayOrder: item.displayOrder });
      }
      return { success: true };
    }),
});
