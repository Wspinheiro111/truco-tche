/**
 * Database helpers for the Tournament system.
 * All tournament persistence lives here — keeps routers thin.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  tournaments, tournamentMatches,
  InsertTournament, InsertTournamentMatch,
  Tournament, TournamentMatch,
} from "../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BracketPlayer {
  id: number;
  name: string;
  avatar: string;
  seed: number;
}

export interface BracketMatch {
  p1: BracketPlayer;
  p2: BracketPlayer;
  winner: BracketPlayer | null;
  score: string | null;
  /** Which player (by id) is the human user, if any */
  humanPlayerId?: number;
}

export interface BracketRound {
  name: string;
  matches: BracketMatch[];
}

export interface BracketData {
  players: BracketPlayer[];
  rounds: BracketRound[];
  currentRoundIdx: number;
}

// ─── Tournaments CRUD ─────────────────────────────────────────────────────────

/**
 * Creates a new tournament and returns it.
 */
export async function createTournament(data: InsertTournament): Promise<Tournament | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(tournaments).values(data).$returningId();
  if (!result?.id) return null;
  return getTournamentById(result.id);
}

/**
 * Fetches a tournament by its ID.
 */
export async function getTournamentById(id: number): Promise<Tournament | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the active tournament for a user, or null if none.
 */
export async function getActiveTournament(userId: number): Promise<Tournament | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(tournaments)
    .where(and(eq(tournaments.userId, userId), eq(tournaments.status, "active")))
    .orderBy(desc(tournaments.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the last N completed tournaments for a user (for history display).
 */
export async function getTournamentHistory(userId: number, limit = 10): Promise<Tournament[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tournaments)
    .where(and(eq(tournaments.userId, userId), eq(tournaments.status, "completed")))
    .orderBy(desc(tournaments.completedAt))
    .limit(limit);
}

/**
 * Updates tournament progress after a match is played.
 */
export async function updateTournamentProgress(
  tournamentId: number,
  update: {
    currentRound?: number;
    wins?: number;
    losses?: number;
    status?: "active" | "completed" | "abandoned";
    coinsAwarded?: number;
    bracketData?: BracketData;
    completedAt?: Date;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (update.currentRound !== undefined) set.currentRound = update.currentRound;
  if (update.wins !== undefined) set.wins = update.wins;
  if (update.losses !== undefined) set.losses = update.losses;
  if (update.status !== undefined) set.status = update.status;
  if (update.coinsAwarded !== undefined) set.coinsAwarded = update.coinsAwarded;
  if (update.bracketData !== undefined) set.bracketData = JSON.stringify(update.bracketData);
  if (update.completedAt !== undefined) set.completedAt = update.completedAt;

  await db.update(tournaments).set(set).where(eq(tournaments.id, tournamentId));
}

/**
 * Abandons all active tournaments for a user (called when starting a new one).
 */
export async function abandonActiveTournaments(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(tournaments)
    .set({ status: "abandoned", updatedAt: new Date() })
    .where(and(eq(tournaments.userId, userId), eq(tournaments.status, "active")));
}

// ─── Tournament Matches ───────────────────────────────────────────────────────

/**
 * Saves the result of a single match within a tournament.
 */
export async function saveTournamentMatch(data: InsertTournamentMatch): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(tournamentMatches).values(data);
}

/**
 * Returns all matches for a given tournament, ordered by round then match index.
 */
export async function getTournamentMatches(tournamentId: number): Promise<TournamentMatch[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tournamentMatches)
    .where(eq(tournamentMatches.tournamentId, tournamentId))
    .orderBy(tournamentMatches.roundIndex, tournamentMatches.matchIndex);
}

// ─── Bracket helpers ──────────────────────────────────────────────────────────

const ROUND_NAMES: Record<number, string> = {
  2: "Final",
  4: "Semifinal",
  8: "Quartas de Final",
  16: "Oitavas de Final",
};

export function getRoundName(playerCount: number): string {
  return ROUND_NAMES[playerCount] ?? `Rodada (${playerCount} jogadores)`;
}

/**
 * Generates the first round of a bracket from a list of players.
 * Players are seeded: 1 vs last, 2 vs second-to-last, etc.
 */
export function generateFirstRound(players: BracketPlayer[]): BracketRound {
  const matches: BracketMatch[] = [];
  const n = players.length;
  for (let i = 0; i < Math.floor(n / 2); i++) {
    matches.push({
      p1: players[i],
      p2: players[n - 1 - i],
      winner: null,
      score: null,
    });
  }
  return { name: getRoundName(n), matches };
}

/**
 * Generates the next round from the winners of the previous round.
 */
export function generateNextRound(prevRound: BracketRound): BracketRound | null {
  const winners = prevRound.matches.map(m => m.winner).filter(Boolean) as BracketPlayer[];
  if (winners.length < 2) return null;
  const matches: BracketMatch[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (winners[i + 1]) {
      matches.push({ p1: winners[i], p2: winners[i + 1], winner: null, score: null });
    }
  }
  return { name: getRoundName(winners.length), matches };
}

/**
 * Checks if all matches in a round are complete.
 */
export function isRoundComplete(round: BracketRound): boolean {
  return round.matches.every(m => m.winner !== null);
}

/**
 * Returns the overall champion if the tournament is over.
 */
export function getBracketChampion(bracketData: BracketData): BracketPlayer | null {
  const lastRound = bracketData.rounds[bracketData.rounds.length - 1];
  if (!lastRound || !isRoundComplete(lastRound)) return null;
  if (lastRound.matches.length === 1) return lastRound.matches[0].winner;
  return null;
}
