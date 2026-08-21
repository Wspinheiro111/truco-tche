import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRulesFailureCsv, formatRulesTestExecution, RULES_TEST_REPORT, rulesTestRouter } from "./rulesTestRouter";

describe("rules test report", () => {
  it("lists the three rule groups with actionable scenarios", () => {
    expect(RULES_TEST_REPORT.summary.categories).toBe(3);
    expect(RULES_TEST_REPORT.groups.map(group => group.id)).toEqual(["truco", "envido", "flor"]);
    expect(RULES_TEST_REPORT.groups.every(group => group.scenarios.length >= 3)).toBe(true);
  });

  it("keeps the administrative report and its loading screen wired in the client", () => {
    const client = [
      readFileSync(resolve(process.cwd(), "client/src/game/legacyMarkup.ts"), "utf8"),
      readFileSync(resolve(process.cwd(), "client/public/game-runtime.js"), "utf8"),
    ].join("\n");
    expect(client).toContain("rules-tests-scr");
    expect(client).toContain("loadRulesTestReport");
    expect(client).toContain("window.loadRulesTestReport = loadRulesTestReport");
    expect(client).toContain("rulesTests.report");
    expect(client).toContain("Histórico de execuções");
    expect(client).toContain("exportRulesFailureCSV");
    expect(client).toContain("rules_test_failure");
    expect(client).toContain("rulesTests.latestFailures");
    expect(client).toContain("startRulesFailureMonitor");
  });

  it("runs the live self-check for an administrator", async () => {
    const caller = rulesTestRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const report = await caller.report();
    expect(report.execution.overall).toBe("passed");
    expect(report.execution.passed).toBe(report.execution.total);
    expect(Array.isArray(report.history)).toBe(true);
  });

  it("exposes an admin-only query for failures persisted by any active instance", async () => {
    const caller = rulesTestRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const failures = await caller.latestFailures({ afterId: 0 });
    expect(failures).toEqual([]);
  });

  it("formats persisted failures and exports a CSV-safe diagnostic", () => {
    const row = {
      id: 42,
      status: "failed",
      passedChecks: 4,
      totalChecks: 5,
      failedChecksJson: JSON.stringify([{ title: 'Contra-Flor "alta"', group: "flor", detail: "Cadeia interrompida" }]),
      executedById: 7,
      executedByName: "Admin Tchê",
      ownerNotified: true,
      createdAt: new Date("2026-08-15T10:00:00.000Z"),
    } as never;
    const formatted = formatRulesTestExecution(row);
    const csv = buildRulesFailureCsv(row);

    expect(formatted.failedChecks).toHaveLength(1);
    expect(formatted.ownerNotified).toBe(true);
    expect(csv).toContain('"Contra-Flor ""alta"""');
    expect(csv).toContain('"sim"');
  });
});
