import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = "/home/ubuntu/truco-tche-manus";
const legacyPath = join(root, "client/index.html");
const gameDir = join(root, "client/src/game");
const cardsDir = "/home/ubuntu/webdev-static-assets/truco-tche-cards";
const html = await readFile(legacyPath, "utf8");

const styleStart = html.indexOf("<style>");
const styleEnd = html.indexOf("</style>", styleStart);
const bodyStart = html.indexOf("<body>", styleEnd) + "<body>".length;
const runtimeStart = html.indexOf("<script>", styleEnd);
const runtimeEnd = html.indexOf("</script>", runtimeStart);
const bodyEnd = html.lastIndexOf("</body>");
if ([styleStart, styleEnd, runtimeStart, runtimeEnd, bodyEnd].some(index => index < 0)) throw new Error("Estrutura legada inesperada no index.html");

const css = html.slice(styleStart + "<style>".length, styleEnd).trim();
const markup = `${html.slice(bodyStart, runtimeStart)}${html.slice(runtimeEnd + "</script>".length, bodyEnd)}`.trim();
let runtime = html.slice(runtimeStart + "<script>".length, runtimeEnd);
const cardsStart = runtime.indexOf("const CARD_IMGS=");
const cardsEnd = runtime.indexOf("\n// ══════════════════════════════════════════════════════════════\n//  PROFILE & STATS", cardsStart);
if (cardsStart < 0 || cardsEnd < 0) throw new Error("Bloco de cartas Base64 não encontrado");

const cardsBlock = runtime.slice(cardsStart, cardsEnd);
const cards = [...cardsBlock.matchAll(/TT_C\["([^\"]+)"\]\[(\d+)\]="data:image\/jpeg;base64,([^\"]+)";/g)];
if (cards.length < 40) throw new Error(`Quantidade inesperada de cartas: ${cards.length}`);
await mkdir(cardsDir, { recursive: true });
for (const [, suit, rank, base64] of cards) await writeFile(join(cardsDir, `${suit.toLowerCase()}-${rank}.jpg`), Buffer.from(base64, "base64"));

runtime = runtime.slice(0, cardsStart)
  + "const CARD_IMGS = window.__TRUCO_CARD_IMGS || { Ouros: {}, Bastos: {}, Espadas: {}, Copas: {} };\nconst TT_C = CARD_IMGS;\nfunction cimg(c){ return CARD_IMGS[c.suit]?.[c.rank] || ''; }\n"
  + runtime.slice(cardsEnd);
runtime = runtime.replace("if(!peer) { const p=new Peer(null,{debug:0}); peer=p; }", "if(!peer) { if (typeof window.Peer !== 'function') { toast('Chamadas locais não estão disponíveis nesta versão.', 'warn'); return; } const p=new window.Peer(null,{debug:0}); peer=p; }");
runtime = runtime.replace(
  "if (typeof QRCode !== 'undefined') {\n    new QRCode(qr, { text: getInPersonInvitePayload(invite.code, invite.inviteToken), width: 220, height: 220, colorDark: '#18372b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });\n  } else {\n    qr.innerHTML = '<div style=\"width:220px;height:220px;display:grid;place-items:center;color:#283\">QR indisponível. Use Copiar convite.</div>';\n  }",
  "if (typeof QRCode === 'undefined') {\n    qr.innerHTML = '<div style=\"width:220px;height:220px;display:grid;place-items:center;color:#283\">Preparando QR Code...</div>';\n    window.__trucoEnsureQrLibraries?.().then(() => renderInPersonHostInvite(invite)).catch(() => { qr.innerHTML = '<div style=\"width:220px;height:220px;display:grid;place-items:center;color:#283\">QR indisponível. Use Copiar convite.</div>'; });\n    return;\n  }\n  new QRCode(qr, { text: getInPersonInvitePayload(invite.code, invite.inviteToken), width: 220, height: 220, colorDark: '#18372b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });"
);
runtime = runtime.replace(
  "if (typeof Html5Qrcode === 'undefined') { setInPersonScannerStatus('Leitor não disponível. Cole o convite copiado pelo anfitrião.'); return; }",
  "if (typeof Html5Qrcode === 'undefined') {\n    setInPersonScannerStatus('Preparando leitor...');\n    try { await window.__trucoEnsureQrLibraries?.(); } catch {}\n    if (typeof Html5Qrcode === 'undefined') { setInPersonScannerStatus('Leitor não disponível. Cole o convite copiado pelo anfitrião.'); return; }\n  }"
);
const globalFunctions = [...new Set([...runtime.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]))].sort();
const bridges = `\n\nconst __legacyGlobal = window;\nObject.defineProperties(__legacyGlobal, {\n  sio: { configurable: true, get: () => sio, set: value => { sio = value; } },\n  AUTH: { configurable: true, get: () => AUTH, set: value => { AUTH = value; } },\n  trpcQuery: { configurable: true, get: () => trpcQuery },\n  trpcMutation: { configurable: true, get: () => trpcMutation },\n});\nObject.assign(__legacyGlobal, { ${globalFunctions.join(", ")} });\n__legacyGlobal.trpcQuery = trpcQuery;\n__legacyGlobal.trpcMutation = trpcMutation;\n`;
runtime = `${runtime}${bridges}`;

const legacyMarkupModule = `export const legacyMarkup = ${JSON.stringify(markup)};\n`;
const minimalHtml = `<!doctype html>\n<html lang="pt-BR">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />\n    <title>Truco Tchê</title>\n    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&display=swap" rel="stylesheet" />\n    <link rel="manifest" href="/manifest.webmanifest" />\n    <link rel="apple-touch-icon" href="/manus-storage/truco-tche-pwa-icon_ae86865a.png" />\n    <meta name="mobile-web-app-capable" content="yes" />\n    <meta name="apple-mobile-web-app-capable" content="yes" />\n    <meta name="apple-mobile-web-app-status-bar-style" content="default" />\n    <meta name="apple-mobile-web-app-title" content="Truco Tchê" />\n    <meta name="theme-color" content="#b8860b" />\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`;

const runtimeLoader = `let bootPromise: Promise<void> | null = null;\n\nexport function bootLegacyRuntime(): Promise<void> {\n  if (bootPromise) return bootPromise;\n  bootPromise = new Promise((resolve, reject) => {\n    const script = document.createElement(\"script\");\n    script.src = \"/game-runtime.js\";\n    script.async = false;\n    script.onload = () => {\n      if (document.readyState !== \"loading\") {\n        document.dispatchEvent(new Event(\"DOMContentLoaded\"));\n        window.dispatchEvent(new Event(\"load\"));\n      }\n      resolve();\n    };\n    script.onerror = () => reject(new Error(\"Não foi possível carregar o runtime do Truco Tchê\"));\n    document.body.appendChild(script);\n  });\n  return bootPromise;\n}\n`;
await mkdir(gameDir, { recursive: true });
await mkdir(join(root, "client/public"), { recursive: true });
await writeFile(join(gameDir, "game.css"), `${css}\n`, "utf8");
await writeFile(join(gameDir, "legacyMarkup.ts"), legacyMarkupModule, "utf8");
await writeFile(join(root, "client/public/game-runtime.js"), runtime, "utf8");
await writeFile(join(gameDir, "legacyRuntime.ts"), runtimeLoader, "utf8");
await writeFile(legacyPath, minimalHtml, "utf8");
console.log(JSON.stringify({ cssBytes: Buffer.byteLength(css), runtimeBytes: Buffer.byteLength(runtime), markupBytes: Buffer.byteLength(markup), cardAssets: cards.length }));
