import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { storagePut } from "./storage";

type ChampionCertificateInput = {
  tournamentId: number;
  tournamentName: string;
  championName: string;
  completedAt: Date;
};

const COLORS = {
  couro: rgb(0.20, 0.09, 0.04),
  erva: rgb(0.06, 0.28, 0.16),
  ouro: rgb(0.84, 0.68, 0.29),
  pergaminho: rgb(0.98, 0.94, 0.84),
  campo: rgb(1, 0.98, 0.92),
};

function centered(page: ReturnType<PDFDocument["addPage"]>, text: string, y: number, font: Awaited<ReturnType<PDFDocument["embedStandardFont"]>>, size: number, color = COLORS.couro) {
  const { width } = page.getSize();
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
}

function wrapText(text: string, maxWidth: number, font: Awaited<ReturnType<PDFDocument["embedStandardFont"]>>, size: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

export async function buildChampionCertificatePdf(input: ChampionCertificateInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificado de Campeão — ${input.tournamentName}`);
  pdf.setAuthor("Truco Tchê");
  pdf.setSubject("Certificado do campeão do torneio mano a mano");
  pdf.setCreationDate(input.completedAt);

  const page = pdf.addPage([842, 595]);
  const { width, height } = page.getSize();
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  page.drawRectangle({ x: 0, y: 0, width, height, color: COLORS.pergaminho });
  page.drawRectangle({ x: 13, y: 13, width: width - 26, height: height - 26, borderColor: COLORS.couro, borderWidth: 2.2 });
  page.drawRectangle({ x: 21, y: 21, width: width - 42, height: height - 42, borderColor: COLORS.ouro, borderWidth: 0.9 });

  centered(page, "TRUCO TCHÊ", 535, bold, 13, COLORS.erva);
  centered(page, "CERTIFICADO DE CAMPEÃO", 482, bold, 29, COLORS.ouro);
  centered(page, "TORNEIO MANO A MANO · 1 CONTRA 1", 450, bold, 11, COLORS.erva);
  centered(page, "Certificamos, para honra da cancha e memória do pago, que", 397, serif, 13);

  page.drawRectangle({ x: 114, y: 326, width: width - 228, height: 47, color: COLORS.campo, borderColor: COLORS.ouro, borderWidth: 0.9 });
  centered(page, input.championName.toUpperCase(), 340, bold, 25, COLORS.couro);

  const recognition = "mostrou firmeza de pulso, respeito pelos viventes e boa mão nas cartas, conquistando o título de campeão do torneio";
  centered(page, recognition, 294, serif, 12);
  centered(page, input.tournamentName.toUpperCase(), 255, bold, 19, COLORS.erva);

  const tribute = "Que este feito fique registrado: na disputa mano a mano, venceu com coragem, parceria de respeito e alma de gaúcho. A cancha reconhece teu mérito, tchê!";
  const tributeLines = wrapText(tribute, width - 120, serif, 11);
  tributeLines.forEach((line, index) => centered(page, line, 211 - index * 16, serif, 11));

  const dateText = input.completedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  page.drawLine({ start: { x: 112, y: 112 }, end: { x: 328, y: 112 }, thickness: 0.7, color: COLORS.couro });
  page.drawLine({ start: { x: 514, y: 112 }, end: { x: 730, y: 112 }, thickness: 0.7, color: COLORS.couro });
  centered(page, dateText, 87, serif, 9);
  centered(page, "Organização do torneio", 87, serif, 9);
  page.drawText("Data da conquista", { x: 177, y: 72, size: 8, font: serif, color: COLORS.couro });
  page.drawText("Assinatura da organização", { x: 565, y: 72, size: 8, font: serif, color: COLORS.couro });
  centered(page, "Truco Tchê · Onde a tradição encontra a cancha digital", 45, bold, 8.5, COLORS.erva);

  return Buffer.from(await pdf.save());
}

export async function createChampionCertificate(input: ChampionCertificateInput) {
  const bytes = await buildChampionCertificatePdf(input);
  const key = `certificates/tournament-${input.tournamentId}-champion.pdf`;
  return storagePut(key, bytes, "application/pdf");
}
