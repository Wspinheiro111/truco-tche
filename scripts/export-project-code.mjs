import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const projectRoot = "/home/ubuntu/truco-tche-manus";
const outputDirectory = "/home/ubuntu/Downloads";
const outputPath = join(outputDirectory, "truco-tche-codigo-completo.txt");
const includedRoots = ["client", "server", "shared", "drizzle", "scripts"];
const rootFiles = [
  ".gitignore", ".prettierignore", ".prettierrc", "README.md", "MIGRACAO_MANUS.md",
  "components.json", "drizzle.config.ts", "package.json", "pnpm-lock.yaml", "template.json",
  "tsconfig.json", "vite.config.ts", "vitest.config.ts", "todo.md",
];
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css", ".json", ".sql", ".md", ".txt", ".webmanifest", ".yml", ".yaml"]);
const excludedDirectories = new Set(["node_modules", "dist", ".git", ".manus-logs", "coverage", "__manus__"]);
const excludedFileNames = new Set([".env", ".env.local", ".env.production"]);

async function collectFiles(directory, result) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) await collectFiles(absolutePath, result);
      continue;
    }
    if (!entry.isFile() || excludedFileNames.has(entry.name)) continue;
    const extension = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
    if (textExtensions.has(extension)) result.push(absolutePath);
  }
}

const files = [];
for (const folder of includedRoots) await collectFiles(join(projectRoot, folder), files);
for (const file of rootFiles) {
  const absolutePath = join(projectRoot, file);
  try {
    if ((await stat(absolutePath)).isFile()) files.push(absolutePath);
  } catch {}
}

const uniqueFiles = [...new Set(files)].sort((a, b) => relative(projectRoot, a).localeCompare(relative(projectRoot, b)));
const lines = [
  "TRUCO TCHÊ — CÓDIGO CONSOLIDADO",
  "Gerado para leitura e download. Segredos, dependências instaladas, arquivos binários e artefatos de build foram excluídos.",
  `Arquivos incluídos: ${uniqueFiles.length}`,
  "",
];

for (const absolutePath of uniqueFiles) {
  const filePath = relative(projectRoot, absolutePath).replaceAll("\\", "/");
  const content = await readFile(absolutePath, "utf8");
  lines.push("/* ============================================================================");
  lines.push(` * ARQUIVO: ${filePath}`);
  lines.push(" * ========================================================================== */");
  lines.push(content.endsWith("\n") ? content.slice(0, -1) : content);
  lines.push("");
  lines.push("");
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(JSON.stringify({ outputPath, fileCount: uniqueFiles.length, byteLength: Buffer.byteLength(lines.join("\n"), "utf8") }));
