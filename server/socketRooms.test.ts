import { describe, expect, it } from "vitest";
import { getWaitingRoomSummaries } from "./socketServer";

describe("getWaitingRoomSummaries", () => {
  it("expõe apenas salas que aguardam um segundo jogador", () => {
    const rooms = [
      { code: "ABCD", hostName: "Will", mode: "1v1", state: null, guestSocket: null, spectators: new Set(["viewer"]) },
      { code: "EFGH", hostName: "Jogando", mode: "1v1", state: {} as never, guestSocket: "guest-socket", spectators: new Set() },
      { code: "JKLM", hostName: "Cheia", mode: "1v1", state: null, guestSocket: "guest-socket", spectators: new Set() },
    ];

    expect(getWaitingRoomSummaries(rooms)).toEqual([
      { code: "ABCD", hostName: "Will", mode: "1v1", spectators: 1 },
    ]);
  });
});
