/**
 * Local authentication router (email + 6-digit PIN)
 * 
 * Improvements applied:
 * - Sugestão 1: PIN reset token sent via email (not returned in response body)
 * - Sugestão 2: Rate limiting — account locked after 5 failed login attempts (15 min)
 * - Sugestão 3: Reset tokens persisted in database (not in-memory Map)
 * - Sugestão 9: City name normalized on registration
 */
import { TRPCError } from '@trpc/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { COOKIE_NAME, ONE_YEAR_MS } from '@shared/const';
import { getSessionCookieOptions } from './_core/cookies';
import { publicProcedure, protectedProcedure, router } from './_core/trpc';
import { sdk } from './_core/sdk';
import * as db from './db';
import { sendPinResetEmail } from './email';

const PIN_REGEX = /^\d{6}$/;
const RESET_APP_ORIGIN = process.env.PUBLIC_APP_URL || 'https://trucotche-cut9vr7p.manus.space';

/** Generates a cryptographically secure reset token */
function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export const localAuthRouter = router({
  /**
   * Register a new player with email + 6-digit PIN
   * Sugestão 9: city is normalized before storage
   */
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
        email: z.string().email(),
        phone: z.string().max(20).optional(),
        state: z.string().length(2).optional(),
        city: z.string().max(100).optional(),
        pin: z.string().regex(PIN_REGEX, 'PIN deve ter exatamente 6 dígitos numéricos'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const email = input.email.toLowerCase();

      // Check if email already exists
      const existing = await db.getUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Este e-mail já está cadastrado. Faça login ou use "Esqueci meu PIN".',
        });
      }

      // Hash the PIN
      const pinHash = await bcrypt.hash(input.pin, 10);

      // Create user (city is normalized inside createLocalUser via normalizeCityName)
      const user = await db.createLocalUser({
        name: input.name,
        email,
        phone: input.phone,
        state: input.state,
        city: input.city,
        pinHash,
      });

      if (!user) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Erro ao criar conta.' });
      }

      // Create session
      const token = await sdk.createSessionToken(user.openId, { name: user.name || '' });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          state: user.state,
          city: user.city,
          role: user.role,
        },
      };
    }),

  /**
   * Login with email + 6-digit PIN
   * Sugestão 2: Locks account for 15 min after 5 consecutive failed attempts
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        pin: z.string().regex(PIN_REGEX, 'PIN deve ter exatamente 6 dígitos'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const email = input.email.toLowerCase();
      const user = await db.getUserByEmail(email);

      if (!user || !user.pinHash) {
        // Return generic message to avoid user enumeration
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'E-mail ou PIN incorretos.',
        });
      }

      // Sugestão 2: Check if account is locked
      const lockStatus = db.checkAccountLocked(user);
      if (lockStatus.locked && lockStatus.until) {
        const minutesLeft = Math.ceil((lockStatus.until.getTime() - Date.now()) / 60000);
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Conta temporariamente bloqueada por muitas tentativas incorretas. Tente novamente em ${minutesLeft} minuto${minutesLeft > 1 ? 's' : ''}.`,
        });
      }

      const valid = await bcrypt.compare(input.pin, user.pinHash);
      if (!valid) {
        // Sugestão 2: Record failed attempt
        const result = await db.recordFailedLogin(user.id);
        const attemptsLeft = Math.max(0, 5 - (result?.attempts ?? 1));
        const lockMsg = attemptsLeft === 0
          ? ' Conta bloqueada por 15 minutos.'
          : ` ${attemptsLeft} tentativa${attemptsLeft !== 1 ? 's' : ''} restante${attemptsLeft !== 1 ? 's' : ''}.`;

        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: `E-mail ou PIN incorretos.${lockMsg}`,
        });
      }

      // Successful login: reset failed attempts counter
      await db.updateUserLastSignedIn(user.id);

      // Create session
      const token = await sdk.createSessionToken(user.openId, { name: user.name || '' });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          state: user.state,
          city: user.city,
          role: user.role,
        },
      };
    }),

  /**
   * Request PIN reset
   * Sugestão 1: Token is sent via email, NOT returned in the response body
   * Sugestão 3: Token is persisted in the database (not in-memory Map)
   */
  forgotPin: publicProcedure
    .input(z.object({
      email: z.string().email(),
    }))
    .mutation(async ({ input }) => {
      const email = input.email.toLowerCase();
      const user = await db.getUserByEmail(email);

      // Always return success to avoid user enumeration
      if (!user || user.loginMethod !== 'local') {
        return {
          success: true,
          message: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.',
        };
      }

      // Sugestão 3: Generate token and persist in database
      const token = generateResetToken();
      await db.createPinResetToken(user.id, token);

      // Sugestão 1: Send token via email (not in response body)
      const emailSent = await sendPinResetEmail(
        user.email!,
        user.name ?? 'Jogador',
        token,
        RESET_APP_ORIGIN,
      );

      if (!emailSent) {
        console.error(`[Auth] Failed to send PIN reset email to ${email}`);
      }

      return {
        success: true,
        message: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.',
        // Token is NOT returned here — only sent via email
        // In development mode without SMTP, check server console logs
      };
    }),

  /**
   * Reset PIN using token received via email
   * Sugestão 3: Validates token from database (not in-memory Map)
   */
  resetPin: publicProcedure
    .input(
      z.object({
        resetToken: z.string(),
        newPin: z.string().regex(PIN_REGEX, 'PIN deve ter exatamente 6 dígitos numéricos'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Sugestão 3: Look up token in database
      const entry = await db.getPinResetToken(input.resetToken);

      if (!entry) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Token inválido ou expirado. Solicite um novo.',
        });
      }

      const pinHash = await bcrypt.hash(input.newPin, 10);
      const consumed = await db.consumePinResetToken(input.resetToken);
      if (!consumed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Token inválido ou expirado. Solicite um novo.',
        });
      }
      await db.updateUserPin(entry.userId, pinHash);

      const user = await db.getUserById(entry.userId);
      if (!user) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Usuário não encontrado.' });
      }

      // Auto-login after reset
      const token = await sdk.createSessionToken(user.openId, { name: user.name || '' });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      return { success: true };
    }),

  /**
   * Save a match result for the logged-in user
   * Sugestão 5: Accepts scorePlayer and scoreOpponent as integers
   */
  saveMatch: protectedProcedure
    .input(
      z.object({
        result: z.enum(['win', 'lose']),
        score: z.string().max(20),
        scorePlayer: z.number().int().min(0).max(30).optional(),
        scoreOpponent: z.number().int().min(0).max(30).optional(),
        characterName: z.string().max(100).optional(),
        characterAvatar: z.string().max(10).optional(),
        durationSeconds: z.number().int().min(0).max(86_400).optional(),
      }).superRefine((value, ctx) => {
        if (value.scorePlayer === undefined || value.scoreOpponent === undefined) return;
        const validOutcome = value.result === 'win'
          ? value.scorePlayer > value.scoreOpponent
          : value.scorePlayer < value.scoreOpponent;
        if (!validOutcome) {
          ctx.addIssue({ code: 'custom', message: 'O resultado deve ser compatível com o placar.', path: ['result'] });
        }
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db.insertMatch({
        userId: ctx.user.id,
        result: input.result,
        score: input.score,
        scorePlayer: input.scorePlayer ?? null,
        scoreOpponent: input.scoreOpponent ?? null,
        characterName: input.characterName ?? null,
        characterAvatar: input.characterAvatar ?? null,
        durationSeconds: input.durationSeconds ?? null,
      });
      return { success: true };
    }),

  /**
   * Get match history for the logged-in user
   */
  history: protectedProcedure
    .input(
      z.object({
        period: z.enum(['day', 'week', 'month', 'year', 'all']).default('all'),
      })
    )
    .query(async ({ input, ctx }) => {
      const matchList = await db.getMatchHistory(ctx.user.id, input.period);

      const wins = matchList.filter(m => m.result === 'win').length;
      const losses = matchList.filter(m => m.result === 'lose').length;
      const total = matchList.length;
      const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

      // Sugestão 5: Calculate average scores from integer fields
      const matchesWithScores = matchList.filter(m => m.scorePlayer !== null && m.scoreOpponent !== null);
      const avgScorePlayer = matchesWithScores.length > 0
        ? Math.round(matchesWithScores.reduce((s, m) => s + (m.scorePlayer ?? 0), 0) / matchesWithScores.length)
        : null;
      const avgScoreOpponent = matchesWithScores.length > 0
        ? Math.round(matchesWithScores.reduce((s, m) => s + (m.scoreOpponent ?? 0), 0) / matchesWithScores.length)
        : null;

      return {
        matches: matchList,
        stats: { wins, losses, total, winRate, avgScorePlayer, avgScoreOpponent },
      };
    }),

  /**
   * Get current user profile (for local auth users)
   */
  profile: protectedProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      phone: ctx.user.phone,
      state: ctx.user.state,
      city: ctx.user.city,
      role: ctx.user.role,
      loginMethod: ctx.user.loginMethod,
      googleLinked: ctx.user.googleLinked ?? false,
      createdAt: ctx.user.createdAt,
    };
  }),

  /**
   * Get global ranking with optional filters
   * Sugestão 6: Includes all users (local + OAuth)
   * Sugestão 9: City filter uses case-insensitive comparison
   */
  ranking: publicProcedure
    .input(
      z.object({
        state: z.string().length(2).optional(),
        city: z.string().max(100).optional(),
      })
    )
    .query(async ({ input }) => {
      const ranking = await db.getRanking(input);
      return ranking;
    }),
});
