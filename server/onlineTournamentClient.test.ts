import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clientSource = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");

describe("online tournament 1×1 client contract", () => {
  it("exposes an online 1×1 creation panel with an even capacity input", () => {
    expect(clientSource).toContain('id="tourney-panel-online"');
    expect(clientSource).toContain('id="ot-capacity"');
    expect(clientSource).toContain('min="2" max="64" step="2"');
    expect(clientSource).toContain("createOnlineOneVsOneTournament");
  });

  it("validates a fair 1×1 capacity before creating a tournament", () => {
    expect(clientSource).toContain("maxPlayers % 2 !== 0");
    expect(clientSource).toContain("número par de 2 a 64 vagas");
  });

  it("uses event delivery and persistent recovery for the drawn private match", () => {
    expect(clientSource).toContain("tournament_match_ready");
    expect(clientSource).toContain("get_tournament_match");
    expect(clientSource).toContain("recover_waiting_room");
    expect(clientSource).toContain("reconnect_game");
  });

  it("downloads the champion certificate locally after a persisted lookup", () => {
    expect(clientSource).toContain("downloadTournamentCertificate(result)");
    expect(clientSource).not.toContain("sio.emit('tournament_certificate_ready', result)");
  });

  it("shows prize and reference time while reserving the draw for manual creator confirmation", () => {
    expect(clientSource).toContain('id="ot-prize"');
    expect(clientSource).toContain('id="ot-start-at"');
    expect(clientSource).toContain("scheduledStartAt");
    expect(clientSource).toContain("startOnlineTournamentManually");
    expect(clientSource).toContain("start_tournament");
  });

  it("renders a no-login public bracket with periodic updates", () => {
    expect(clientSource).toContain('id="public-tournament-scr"');
    expect(clientSource).toContain("/api/public/tournaments/");
    expect(clientSource).toContain("openPublicTournamentFromUrl");
    expect(clientSource).toContain("publicTournamentPoll");
  });

  it("shows champion titles and protected certificate links in the profile", () => {
    expect(clientSource).toContain("championTournaments");
    expect(clientSource).toContain("Títulos na cancha");
    expect(clientSource).toContain("📜 Certificado");
  });

  it("uses an explicit accessible confirmation modal before cancellation", () => {
    expect(clientSource).toContain('id = \'tournament-cancel-dialog\'');
    expect(clientSource).toContain("setAttribute('aria-modal', 'true')");
    expect(clientSource).toContain("CANCELAR");
    expect(clientSource).not.toContain("if (!confirm('Cancelar este campeonato?");
  });

  it("offers a new edition only for the organizer of a completed tournament", () => {
    expect(clientSource).toContain("t.status === 'completed'");
    expect(clientSource).toContain("duplicateOnlineTournament");
    expect(clientSource).toContain("duplicate_tournament");
  });

  it("opens an editable preview before confirming the duplicated edition", () => {
    expect(clientSource).toContain('id = \'tournament-duplicate-dialog\'');
    expect(clientSource).toContain("Pré-visualizar nova edição");
    expect(clientSource).toContain('id="td-name"');
    expect(clientSource).toContain('id="td-prize"');
    expect(clientSource).toContain('id="td-capacity"');
    expect(clientSource).toContain('id="td-schedule"');
    expect(clientSource).toContain("Confirmar nova edição");
  });
});
