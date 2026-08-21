import { readFile, writeFile } from "node:fs/promises";

const root = "/home/ubuntu/truco-tche-manus";
const runtimeSourcePath = `${root}/client/src/game/legacyRuntime.ts`;
const runtimeOutputPath = `${root}/client/public/game-runtime.js`;
const loaderOutputPath = `${root}/client/src/game/legacyRuntime.ts`;
let runtime = await readFile(runtimeSourcePath, "utf8");
if (!runtime.includes("function cimg(c)")) runtime = await readFile(runtimeOutputPath, "utf8");

runtime = runtime.replace(/^\/\/ @ts-nocheck\n/, "");
const sfxShim = `const SFX = window.SFX || { click(){}, card(){}, truco(){}, reveal(){}, win(){}, lose(){}, unlock(){}, deal(){}, envido(){}, flor(){} };\nwindow.SFX = SFX;\n`;
if (!runtime.includes("const SFX =")) runtime = `${sfxShim}${runtime}`;
runtime = runtime.replace(
  "import { CARD_IMGS, cimg } from './cards';",
  "const CARD_IMGS = window.__TRUCO_CARD_IMGS || { Ouros: {}, Bastos: {}, Espadas: {}, Copas: {} };\nconst TT_C = CARD_IMGS;\nfunction cimg(c){ return CARD_IMGS[c.suit]?.[c.rank] || ''; }"
);
runtime = runtime.replace(/\n\nconst __legacyGlobal = window;[\s\S]*$/, "\n");
if (!runtime.includes("function cimg(c)")) throw new Error("Runtime extraído não contém o helper de cartas");

const loader = `let bootPromise: Promise<void> | null = null;\n\nexport function bootLegacyRuntime(): Promise<void> {\n  if (bootPromise) return bootPromise;\n  bootPromise = new Promise((resolve, reject) => {\n    const script = document.createElement(\"script\");\n    script.src = \"/game-runtime.js\";\n    script.async = false;\n    script.onload = () => {\n      if (document.readyState !== \"loading\") {\n        document.dispatchEvent(new Event(\"DOMContentLoaded\"));\n        window.dispatchEvent(new Event(\"load\"));\n      }\n      resolve();\n    };\n    script.onerror = () => reject(new Error(\"Não foi possível carregar o runtime do Truco Tchê\"));\n    document.body.appendChild(script);\n  });\n  return bootPromise;\n}\n`;

await writeFile(runtimeOutputPath, runtime, "utf8");
await writeFile(loaderOutputPath, loader, "utf8");
console.log(JSON.stringify({ runtimeBytes: Buffer.byteLength(runtime), loaderBytes: Buffer.byteLength(loader) }));
