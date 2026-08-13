import { describe, expect, it } from "vitest";
import { getWaitingRoomSummaries, normalizeRoomPreferences } from "./socketServer";

describe("getWaitingRoomSummaries", () => {
  it("expõe apenas salas que aguardam um segundo jogador", () => {
    const rooms = [
      { code: "ABCD", hostName: "Will", mode: "1v1", stakeTier: "baixo", region: "1", state: null, guestSocket: null, spectators: new Set(["viewer"]) },
      { code: "EFGH", hostName: "Jogando", mode: "1v1", stakeTier: "alto", region: "2", state: {} as never, guestSocket: "guest-socket", spectators: new Set() },
      { code: "JKLM", hostName: "Cheia", mode: "desafio", stakeTier: "medio", region: "1", state: null, guestSocket: "guest-socket", spectators: new Set() },
    ];

    expect(getWaitingRoomSummaries(rooms)).toEqual([
      { code: "ABCD", hostName: "Will", mode: "1v1", stakeTier: "baixo", region: "1", spectators: 1 },
    ]);
  });

  it("filtra por modo, aposta virtual e região", () => {
    const rooms = [
      { code: "ABCD", hostName: "Will", mode: "1v1", stakeTier: "baixo", region: "1", state: null, guestSocket: null, spectators: new Set() },
      { code: "QWER", hostName: "Guria", mode: "desafio", stakeTier: "alto", region: "2", state: null, guestSocket: null, spectators: new Set() },
    ];

    expect(getWaitingRoomSummaries(rooms, { mode: "desafio", stakeTier: "alto", region: "2" })).toMatchObject([{ code: "QWER" }]);
    expect(normalizeRoomPreferences({ mode: "invalido", stakeTier: "ALTO", region: "40" })).toEqual({ mode: "1v1", stakeTier: "alto", region: "40" });
  });
});
