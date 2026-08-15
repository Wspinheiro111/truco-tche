import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

describe("multiplayer recovery client contract", () => {
  it("executa a restauração dos modais de Truco, Envido e Flor", () => {
    const client = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
    const start = client.indexOf("function restorePendingOnlineNegotiation(state)");
    const end = client.indexOf("// ── Socket.io Connection", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const calls: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const context = {
      document: { getElementById: () => null },
      showOnlineTrucoModal: (data: Record<string, unknown>) => calls.push({ kind: "truco", data }),
      showOnlineEnvidoModal: (data: Record<string, unknown>) => calls.push({ kind: "envido", data }),
      showOnlineFlorModal: (data: Record<string, unknown>) => calls.push({ kind: "flor", data }),
    };
    vm.runInNewContext(`${client.slice(start, end)}; globalThis.restore = restorePendingOnlineNegotiation;`, context);
    const restore = (context as typeof context & { restore: (state: Record<string, unknown>) => void }).restore;

    restore({ phase: "truco_neg", turn: "p2", myRole: "p2", trucoCaller: "p1", trucoLevel: 2, myName: "Eu", opponentName: "Oponente" });
    restore({ phase: "envido_neg", turn: "p2", myRole: "p2", envidoCaller: "p1", envidoChain: ["envido"], envidoBet: 2, myName: "Eu", opponentName: "Oponente" });
    restore({ phase: "flor_neg", turn: "p2", myRole: "p2", florCaller: "p1", florChain: ["flor"], florBet: 3, myName: "Eu", opponentName: "Oponente" });

    expect(calls).toEqual([
      { kind: "truco", data: { level: 2, callerName: "Oponente" } },
      { kind: "envido", data: { action: "envido", bet: 2, callerName: "Oponente" } },
      { kind: "flor", data: { action: "flor", bet: 3, callerName: "Oponente" } },
    ]);
  });

  it("mantém o contrato de lock otimista e registro de evento no snapshot", () => {
    const server = readFileSync(resolve(process.cwd(), "server/socketServer.ts"), "utf8");
    expect(server).toContain("updateActiveOnlineGame(room.code, room.snapshotVersion");
    expect(server).toContain("lastEventId: eventId");
    expect(server).toContain("room.snapshotVersion += 1");
    expect(server).toContain("room.snapshotVersion = latest.version");
  });
});
