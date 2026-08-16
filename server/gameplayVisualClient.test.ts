import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");

describe("gameplay visual contract", () => {
  it("keeps the full player hand responsive without clipping card containers", () => {
    expect(html).toContain("width:clamp(54px,18vw,82px)");
    expect(html).toContain("height:clamp(82px,26vw,122px)");
    expect(html).toContain("#online-game .hand,#p-hand");
    expect(html).toContain("overflow:visible");
    expect(html).toContain("@media (max-width:390px)");
  });

  it("retains a resolved online trick with both cards and a visible winner result", () => {
    expect(html).toContain('id="og-trick-result"');
    expect(html).toContain("showOnlineResolvedTrick(data)");
    expect(html).toContain("const tableCards = state.table && state.table.length ? state.table : (resolvedTrick ? resolvedTrick.cards : [])");
    expect(html).toContain("Você ganhou a vaza");
    expect(html).toContain("Adversário ganhou a vaza");
  });
});
