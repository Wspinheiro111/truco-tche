import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({
    key: "certificates/tournament-42-champion.pdf",
    url: "https://storage.example/certificates/tournament-42-champion.pdf",
  }),
}));

import { buildChampionCertificatePdf, createChampionCertificate } from "./tournamentCertificate";
import { storagePut } from "./storage";

describe("champion tournament certificate", () => {
  it("generates a valid one-page PDF with champion and tournament fields", async () => {
    const bytes = await buildChampionCertificatePdf({
      tournamentId: 42,
      tournamentName: "Copa do Pago",
      championName: "Will Pinheiro",
      completedAt: new Date("2026-08-16T12:00:00.000Z"),
    });
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain("Copa do Pago");
  });

  it("stores the champion certificate with a stable tournament key", async () => {
    const saved = await createChampionCertificate({
      tournamentId: 42,
      tournamentName: "Copa do Pago",
      championName: "Will Pinheiro",
      completedAt: new Date("2026-08-16T12:00:00.000Z"),
    });
    expect(storagePut).toHaveBeenCalledWith(
      "certificates/tournament-42-champion.pdf",
      expect.any(Buffer),
      "application/pdf",
    );
    expect(saved.url).toContain("tournament-42-champion.pdf");
  });
});
