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
});
