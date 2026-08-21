import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { storagePut } from "../server/storage";

const root = "/home/ubuntu/truco-tche-manus";
const sourceDir = "/home/ubuntu/webdev-static-assets/truco-tche-cards";
const outputPath = join(root, "client/src/game/cardsManifest.ts");
const suitNames: Record<string, string> = { ouros: "Ouros", bastos: "Bastos", espadas: "Espadas", copas: "Copas" };
const files = (await readdir(sourceDir)).filter(file => file.endsWith(".jpg")).sort();
if (files.length !== 40) throw new Error(`Esperadas 40 cartas, encontradas ${files.length}`);

const manifest: Record<string, Record<number, string>> = { Ouros: {}, Bastos: {}, Espadas: {}, Copas: {} };
for (const file of files) {
  const match = file.match(/^(ouros|bastos|espadas|copas)-(\d+)\.jpg$/);
  if (!match) throw new Error(`Nome de carta inválido: ${file}`);
  const [, rawSuit, rawRank] = match;
  const data = await readFile(join(sourceDir, file));
  const { url } = await storagePut(`truco-tche/cards/${file}`, data, "image/jpeg");
  manifest[suitNames[rawSuit]][Number(rawRank)] = url;
}

const source = `export type CardSuit = "Ouros" | "Bastos" | "Espadas" | "Copas";\n\nconst CARD_PATHS: Record<CardSuit, Record<number, string>> = ${JSON.stringify(manifest, null, 2)};\n\nexport const CARD_URLS: Record<CardSuit, Record<number, string>> = Object.fromEntries(\n  Object.entries(CARD_PATHS).map(([suit, ranks]) => [suit, Object.fromEntries(Object.entries(ranks).map(([rank, path]) => [Number(rank), typeof window === "undefined" ? path : new URL(path, window.location.origin).href]))])\n) as Record<CardSuit, Record<number, string>>;\n\nexport default CARD_URLS;\n`;
await writeFile(outputPath, source, "utf8");
console.log(JSON.stringify({ cardCount: files.length, outputPath }));
