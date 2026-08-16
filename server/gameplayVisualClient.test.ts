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

  it("reconcilia rapidamente o estado persistido entre instâncias durante a espera e após ações", () => {
    expect(html).toContain("const ONLINE_STATE_SYNC_WAITING_MS = 700");
    expect(html).toContain("const ONLINE_STATE_SYNC_PLAYING_MS = 1200");
    expect(html).toContain("function syncOnlineStateNow()");
    expect(html).toContain("sioGameActive ? ONLINE_STATE_SYNC_PLAYING_MS : ONLINE_STATE_SYNC_WAITING_MS");
    expect(html).toContain("sio.emit('play_card', { cardId: card.id }");
    expect(html).toContain("syncOnlineStateNow();");
  });

  it("mantém a mesa com placar superior e controles laterais no desktop, preservando ações acessíveis no mobile", () => {
    expect(html).toContain("<div class=\"og-hdr\">");
    expect(html).toContain("position:absolute;");
    expect(html).toContain("transform:translateY(-38%)");
    expect(html).toContain("@media (max-width:820px)");
    expect(html).toContain(".og-action-btns{flex-direction:row");
    expect(html).toContain("padding:.4rem clamp(.4rem,13vw,11rem) .4rem .4rem");
  });

  it("expõe uma auditoria objetiva para a mesa mobile com placar, ações, mão e vaza dentro do viewport", () => {
    expect(html).toContain("function auditOnlineMobileLayout()");
    expect(html).toContain("scoreVisible: withinViewport(score)");
    expect(html).toContain("actionsVisible: withinViewport(actions)");
    expect(html).toContain("handVisible: withinViewport(hand)");
    expect(html).toContain("tableVisible: withinViewport(table)");
    expect(html).toContain("cardsVisible: cards.length === 3 && cards.every(withinViewport)");
    expect(html).toContain('document.body.dataset.onlineLayoutAudit = JSON.stringify(result)');
  });
});
