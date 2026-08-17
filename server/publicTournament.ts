import type { Express } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { onlineTournamentPlayers, onlineTournaments } from "../drizzle/schema";

export function toPublicTournament(tournament: typeof onlineTournaments.$inferSelect, playerCount: number) {
  let bracket = null;
  try {
    bracket = tournament.bracketData ? JSON.parse(tournament.bracketData) : null;
  } catch {
    bracket = null;
  }
  return {
    id: tournament.id,
    name: tournament.name,
    maxPlayers: tournament.maxPlayers,
    currentPlayers: playerCount,
    status: tournament.status,
    prize: tournament.prize,
    scheduledStartAt: tournament.scheduledStartAt,
    currentRound: tournament.currentRound,
    completedAt: tournament.completedAt,
    bracket,
  };
}

export function registerPublicTournamentRoutes(app: Express) {
  app.get("/api/public/tournaments/:tournamentId", async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
      return res.status(400).json({ error: "Torneio inválido" });
    }
    try {
      const database = await getDb();
      if (!database) return res.status(503).json({ error: "Base de dados indisponível" });
      const [tournament] = await database.select().from(onlineTournaments)
        .where(eq(onlineTournaments.id, tournamentId));
      if (!tournament) return res.status(404).json({ error: "Torneio não encontrado" });
      const players = await database.select({ id: onlineTournamentPlayers.id }).from(onlineTournamentPlayers)
        .where(eq(onlineTournamentPlayers.tournamentId, tournamentId));
      res.setHeader("Cache-Control", "no-store");
      return res.json({ tournament: toPublicTournament(tournament, players.length) });
    } catch (error) {
      console.error("[PublicTournament] failed to load tournament:", error);
      return res.status(500).json({ error: "Não foi possível carregar a chave pública" });
    }
  });
}
