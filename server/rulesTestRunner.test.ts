import { describe, expect, it } from "vitest";
import { runRulesSelfCheck } from "./rulesTestRunner";

describe("rules self-check", () => {
  it("executes representative Truco, Envido and Flor checks", () => {
    const result = runRulesSelfCheck();
    expect(result.overall).toBe("passed");
    expect(result.total).toBeGreaterThanOrEqual(5);
    expect(new Set(result.checks.map(check => check.group))).toEqual(new Set(["truco", "envido", "flor"]));
  });
});
