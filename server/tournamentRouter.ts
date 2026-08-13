/**
 * Tournament tRPC router
 * Handles all tournament lifecycle: creation, match results, bracket advancement, history.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import {
  createTournament, getTournamentById, getActiveTournament,
  getTournamentHistory, updateTournamentProgress, abandonActiveTournaments,
  saveTournamentMatch, getTournamentMatches,
  generateFirstRound, generateNextRound, isRoundComplete, getBracketChampion,
  BracketData, BracketPlayer,
} from "./tournamentDb";

// ─── Shared schemas ───────────────────────────────────────────────────────────

const bracketPlayerSchema = z.object({
  id: z.number(),
  name: z.string(),
  avatar: z.string(),
  seed: z.number(),
});

export const tournamentRouter = router({

  /**
   * Start a new AI tournament (Torneio dos Piquetes).
   * Abandons any existing active tournament first.
   * opponentIds: ordered array of AI character IDs to face.
   */
  startAI: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100).default("Torneio dos Piquetes"),
      opponentIds: z.array(z.string()).min(1).max(20),
      prizeCoins: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      await abandonActiveTournaments(ctx.user.id);

      const tournament = await createTournament({
        userId: ctx.user.id,
        name: input.name,
        type: "ai",
        status: "active",
        totalRounds: input.opponentIds.length,
        currentRound: 0,
        wins: 0,
        losses: 0,
        prizeCoins: input.prizeCoins,
        opponentIds: JSON.stringify(input.opponentIds),
      });

      if (!tournament) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao criar torneio." });
      }

      return { tournamentId: tournament.id, tournament };
    }),

  /**
   * Start a new bracket tournament (human players).
   * Players list must include the current user as player[0].
   */
  startBracket: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100).default("Torneio Gaúcho"),
      players: z.array(bracketPlayerSchema).min(2).max(16),
    }))
    .mutation(async ({ input, ctx }) => {
      await abandonActiveTournaments(ctx.user.id);

      const firstRound = generateFirstRound(input.players);
      const bracketData: BracketData = {
        players: input.players,
        rounds: [firstRound],
        currentRoundIdx: 0,
      };

      // Total rounds = log2(players.length) for power-of-2 brackets
      const totalRounds = Math.ceil(Math.log2(input.players.length));

      const tournament = await createTournament({
        userId: ctx.user.id,
        name: input.name,
        type: "bracket",
        status: "active",
        totalRounds,
        currentRound: 0,
        wins: 0,
        losses: 0,
        prizeCoins: input.players.length * 50,
        bracketData: JSON.stringify(bracketData),
      });

      if (!tournament) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao criar torneio." });
      }

      return { tournamentId: tournament.id, tournament, bracketData };
    }),

  /**
   * Get the current active tournament for the logged-in user.
   * Returns null if no active tournament exists.
   */
  getActive: protectedProcedure.query(async ({ ctx }) => {
    const tournament = await getActiveTournament(ctx.user.id);
    if (!tournament) return null;

    const tournamentMatches = await getTournamentMatches(tournament.id);

    let bracketData: BracketData | null = null;
    if (tournament.type === "bracket" && tournament.bracketData) {
      try { bracketData = JSON.parse(tournament.bracketData); } catch { /* ignore */ }
    }

    let opponentIds: string[] = [];
    if (tournament.type === "ai" && tournament.opponentIds) {
      try { opponentIds = JSON.parse(tournament.opponentIds); } catch { /* ignore */ }
    }

    return { tournament, matches: tournamentMatches, bracketData, opponentIds };
  }),

  /**
   * Record the result of a match in the active tournament.
   * For AI tournaments: advances to next round automatically.
   * For bracket tournaments: updates the bracket state.
   */
  recordMatchResult: protectedProcedure
    .input(z.object({
      tournamentId: z.number().int(),
      result: z.enum(["win", "lose"]),
      score: z.string().max(20),
      scorePlayer: z.number().int().min(0).max(30).optional(),
      scoreOpponent: z.number().int().min(0).max(30).optional(),
      opponentName: z.string().max(100).optional(),
      opponentAvatar: z.string().max(10).optional(),
      durationSeconds: z.number().int().optional(),
      /** For bracket: roundIndex and matchIndex to update */
      roundIndex: z.number().int().min(0).optional(),
      matchIndex: z.number().int().min(0).optional(),
      /** For bracket: the winner player object */
      winnerPlayer: bracketPlayerSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const tournament = await getTournamentById(input.tournamentId);
      if (!tournament) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Torneio não encontrado." });
      }
      if (tournament.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado." });
      }
      if (tournament.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este torneio já foi encerrado." });
      }

      // Save the match record
      await saveTournamentMatch({
        tournamentId: tournament.id,
        userId: ctx.user.id,
        roundIndex: input.roundIndex ?? tournament.currentRound,
        matchIndex: input.matchIndex ?? 0,
        result: input.result,
        score: input.score,
        scorePlayer: input.scorePlayer ?? null,
        scoreOpponent: input.scoreOpponent ?? null,
        opponentName: input.opponentName ?? null,
        opponentAvatar: input.opponentAvatar ?? null,
        durationSeconds: input.durationSeconds ?? null,
      });

      const isWin = input.result === "win";
      const newWins = tournament.wins + (isWin ? 1 : 0);
      const newLosses = tournament.losses + (isWin ? 0 : 1);

      // ── AI Tournament ──
      if (tournament.type === "ai") {
        const nextRound = tournament.currentRound + 1;
        const isOver = nextRound >= tournament.totalRounds;

        if (isOver) {
          const coinsAwarded = Math.floor(tournament.prizeCoins * newWins / tournament.totalRounds);
          await updateTournamentProgress(tournament.id, {
            currentRound: nextRound,
            wins: newWins,
            losses: newLosses,
            status: "completed",
            coinsAwarded,
            completedAt: new Date(),
          });
          return {
            status: "completed",
            wins: newWins,
            losses: newLosses,
            totalRounds: tournament.totalRounds,
            coinsAwarded,
            isChampion: newWins === tournament.totalRounds,
          };
        }

        await updateTournamentProgress(tournament.id, {
          currentRound: nextRound,
          wins: newWins,
          losses: newLosses,
        });

        return {
          status: "active",
          currentRound: nextRound,
          wins: newWins,
          losses: newLosses,
          totalRounds: tournament.totalRounds,
        };
      }

      // ── Bracket Tournament ──
      if (tournament.type === "bracket") {
        if (!tournament.bracketData) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Dados do bracket não encontrados." });
        }

        let bracketData: BracketData;
        try { bracketData = JSON.parse(tournament.bracketData); }
        catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao ler bracket." }); }

        const roundIdx = input.roundIndex ?? bracketData.currentRoundIdx;
        const matchIdx = input.matchIndex ?? 0;
        const round = bracketData.rounds[roundIdx];

        if (!round || !round.matches[matchIdx]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Partida não encontrada no bracket." });
        }

        // Update the match winner
        if (input.winnerPlayer) {
          round.matches[matchIdx].winner = input.winnerPlayer;
          round.matches[matchIdx].score = input.score;
        }

        // Check if round is complete → generate next round
        let newStatus: "active" | "completed" = "active";
        let champion: BracketPlayer | null = null;

        if (isRoundComplete(round)) {
          champion = getBracketChampion(bracketData);
          if (champion) {
            newStatus = "completed";
          } else {
            const nextRound = generateNextRound(round);
            if (nextRound) {
              bracketData.rounds.push(nextRound);
              bracketData.currentRoundIdx = bracketData.rounds.length - 1;
            }
          }
        }

        const coinsAwarded = newStatus === "completed"
          ? Math.floor(tournament.prizeCoins * newWins / Math.max(1, tournament.totalRounds))
          : undefined;

        await updateTournamentProgress(tournament.id, {
          currentRound: bracketData.currentRoundIdx,
          wins: newWins,
          losses: newLosses,
          status: newStatus,
          bracketData,
          ...(newStatus === "completed" ? { coinsAwarded, completedAt: new Date() } : {}),
        });

        return {
          status: newStatus,
          bracketData,
          champion,
          wins: newWins,
          losses: newLosses,
          coinsAwarded,
        };
      }

      return { status: "active" };
    }),

  /**
   * Abandon the current active tournament.
   */
  abandon: protectedProcedure.mutation(async ({ ctx }) => {
    await abandonActiveTournaments(ctx.user.id);
    return { success: true };
  }),

  /**
   * Get tournament history for the logged-in user.
   */
  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input, ctx }) => {
      const history = await getTournamentHistory(ctx.user.id, input.limit);
      return history.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        totalRounds: t.totalRounds,
        wins: t.wins,
        losses: t.losses,
        coinsAwarded: t.coinsAwarded,
        isChampion: t.wins === t.totalRounds,
        completedAt: t.completedAt,
      }));
    }),

  /**
   * Get detailed matches for a specific tournament.
   */
  getMatches: protectedProcedure
    .input(z.object({ tournamentId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const tournament = await getTournamentById(input.tournamentId);
      if (!tournament || tournament.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Torneio não encontrado." });
      }
      return getTournamentMatches(input.tournamentId);
    }),
});
