import { describe, expect, it } from "vitest";
import { toPublicTournament } from "./publicTournament";

describe("public tournament bracket", () => {
  it("exposes bracket progress without leaking the champion certificate URL", () => {
    const source = {
      id: 9,
      creatorId: 1,
      name: "Copa do Pago",
      maxPlayers: 8,
      status: "active",
      prize: "Troféu do Pago",
      scheduledStartAt: new Date("2026-08-20T19:00:00Z"),
      bracketData: JSON.stringify({ rounds: [[{ p1Name: "Ana", p2Name: "Bia" }]] }),
      totalRounds: 3,
      currentRound: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      championCertificateKey: "certificates/private.pdf",
      championCertificateUrl: "https://private.example/certificate.pdf",
    } as any;
    const result = toPublicTournament(source, 6);
    expect(result).toMatchObject({ id: 9, name: "Copa do Pago", currentPlayers: 6, prize: "Troféu do Pago" });
    expect(result.bracket).toEqual({ rounds: [[{ p1Name: "Ana", p2Name: "Bia" }]] });
    expect(JSON.stringify(result)).not.toContain("private.example");
    expect(JSON.stringify(result)).not.toContain("championCertificate");
  });
});
