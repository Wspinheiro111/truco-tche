import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
const loaderSource = html.match(/async function loadRulesTestReport\(\) \{[\s\S]*?window\.loadRulesTestReport = loadRulesTestReport;/);
if (!loaderSource) throw new Error("Carregador do relatório de regras não encontrado");

function setupClient(query: () => Promise<unknown>) {
  const body = { innerHTML: "" };
  const sandbox: Record<string, unknown> = {
    document: { getElementById: vi.fn(() => body) },
    trpcQuery: query,
    escapeRoomText: (value: unknown) => String(value),
    Date,
    Number,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(`${loaderSource[0]}; globalThis.runLoader = loadRulesTestReport;`, sandbox);
  return { body, runLoader: sandbox.runLoader as () => Promise<void> };
}

describe("rules test page loader", () => {
  it("renders loading and a successful live self-check response", async () => {
    let complete: (value: unknown) => void = () => undefined;
    const client = setupClient(() => new Promise(resolve => { complete = resolve; }));
    const pending = client.runLoader();
    expect(client.body.innerHTML).toContain("Consultando cobertura automatizada");

    complete({
      suite: "Vitest",
      summary: { covered: 20, categories: 3, runner: "Vitest" },
      groups: [
        { title: "Truco", description: "Chamadas", scenarios: ["Aceite", "Recusa"] },
        { title: "Envido", description: "Pontos", scenarios: ["Bloqueio"] },
        { title: "Flor", description: "Cadeia", scenarios: ["Contra-Flor"] },
      ],
      execution: {
        overall: "passed", passed: 5, total: 5,
        checks: [
          { title: "Truco é aceito", group: "truco", passed: true },
          { title: "Truco mantém turno", group: "truco", passed: true },
          { title: "Envido bloqueado", group: "envido", passed: true },
          { title: "Flor chamada", group: "flor", passed: true },
          { title: "Contra-Flor chamada", group: "flor", passed: true },
        ],
      },
      generatedAt: "2026-08-15T00:00:00.000Z",
    });
    await pending;
    expect(client.body.innerHTML).toContain("Autoverificação em tempo real");
    expect(client.body.innerHTML).toContain("Mapa de Cobertura");
    expect(client.body.innerHTML).toContain("5/5");
    expect(client.body.innerHTML).toContain("2/2 · 100%");
    expect((client.body.innerHTML.match(/role=\"progressbar\"/g) || []).length).toBe(6);
    expect(client.body.innerHTML).toContain("Truco é aceito");
  });

  it("renders a recoverable error state when the protected report is unavailable", async () => {
    const client = setupClient(async () => { throw new Error("FORBIDDEN"); });
    await client.runLoader();
    expect(client.body.innerHTML).toContain("Relatório indisponível");
    expect(client.body.innerHTML).toContain("Tentar novamente");
  });

  it("keeps the administrative screen in the document", () => {
    expect(html).toContain('id="rules-tests-scr"');
    expect(html).toContain("window.loadRulesTestReport = loadRulesTestReport");
  });
});
