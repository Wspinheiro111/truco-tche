import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RULES_TEST_REPORT, rulesTestRouter } from "./rulesTestRouter";

describe("rules test report", () => {
  it("lists the three rule groups with actionable scenarios", () => {
    expect(RULES_TEST_REPORT.summary.categories).toBe(3);
    expect(RULES_TEST_REPORT.groups.map(group => group.id)).toEqual(["truco", "envido", "flor"]);
    expect(RULES_TEST_REPORT.groups.every(group => group.scenarios.length >= 3)).toBe(true);
  });

  it("keeps the administrative report and its loading screen wired in the client", () => {
    const client = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
    expect(client).toContain("rules-tests-scr");
    expect(client).toContain("loadRulesTestReport");
    expect(client).toContain("window.loadRulesTestReport = loadRulesTestReport");
    expect(client).toContain("rulesTests.report");
  });

  it("runs the live self-check for an administrator", async () => {
    const caller = rulesTestRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const report = await caller.report();
    expect(report.execution.overall).toBe("passed");
    expect(report.execution.passed).toBe(report.execution.total);
  });
});
