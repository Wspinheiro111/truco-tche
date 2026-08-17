import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { localAuthRouter } from "./localAuth";
import { tournamentRouter } from "./tournamentRouter";
import { sponsorRouter } from "./sponsorRouter";
import { adminRouter } from "./adminRouter";
import { pilasRouter } from "./pilasRouter";
import { friendsRouter } from "./friendsRouter";
import { rulesTestRouter } from "./rulesTestRouter";
import { pushRouter } from "./pushRouter";
import { getOnlineMatchHistory, getTournamentBracket, unlinkGoogleAccount } from "./db";

/**
 * Build the Manus OAuth login URL from server-side env vars.
 * The frontend (index.html) cannot access import.meta.env directly,
 * so we expose this via a tRPC public procedure.
 */
function buildManusLoginUrl(origin: string): string {
  const oauthPortalUrl = process.env.VITE_OAUTH_PORTAL_URL ?? 'https://manus.im';
  const appId = process.env.VITE_APP_ID ?? '';
  const redirectUri = `${origin}/api/oauth/callback`;
  const state = Buffer.from(redirectUri).toString('base64');
  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set('appId', appId);
  url.searchParams.set('redirectUri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('type', 'signIn');
  return url.toString();
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    /**
     * Returns the Manus OAuth login URL built from server env vars.
     * Used by index.html (which cannot access import.meta.env) to render
     * the "Entrar com Google" and "Entrar com Manus" social login buttons.
     * The client passes its own origin so the redirect URI is always correct.
     */
    loginUrl: publicProcedure
      .input(z.object({ origin: z.string().url() }))
      .query(({ input }) => ({
        url: buildManusLoginUrl(input.origin),
      })),

    /**
     * Returns whether the current user has a Google account linked.
     * Used by the Conta screen to show the link/unlink button.
     */
    linkStatus: protectedProcedure.query(({ ctx }) => ({
      googleLinked: ctx.user.googleLinked ?? false,
      loginMethod: ctx.user.loginMethod,
      email: ctx.user.email,
    })),

    /**
     * Unlinks Google from the current user's account.
     * Restores the local:email openId format and clears googleLinked.
     * Only available if the user has a PIN set (so they can still log in).
     */
    unlinkGoogle: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.user.pinHash) {
        throw new Error('Não é possível desvincular: você não tem um PIN configurado. Configure um PIN antes de desvincular o Google.');
      }
      await unlinkGoogleAccount(ctx.user.id);
      return { success: true };
    }),
  }),
  localAuth: localAuthRouter,
  tournament: tournamentRouter,
  sponsor: sponsorRouter,
  admin: adminRouter,
  pilas: pilasRouter,
  friends: friendsRouter,
  rulesTests: rulesTestRouter,
  push: pushRouter,
  online: router({
    matchHistory: protectedProcedure.query(async ({ ctx }) => {
      return getOnlineMatchHistory(ctx.user.id, 30);
    }),
    tournamentBracket: publicProcedure
      .input(z.object({ tournamentId: z.number().int().positive() }))
      .query(async ({ input }) => {
        return getTournamentBracket(input.tournamentId);
      }),
  }),
});

export type AppRouter = typeof appRouter;
