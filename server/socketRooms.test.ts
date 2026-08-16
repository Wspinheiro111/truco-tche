import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canJoinPrivateRoom, getTotalOnlinePlayers, getWaitingRoomSummaries, isWaitingRoomExpired, normalizeRoomPreferences } from "./socketServer";

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

  it("conta jogadores autenticados únicos, não conexões duplicadas", () => {
    expect(getTotalOnlinePlayers([{ userId: 7 }, { userId: 7 }, { userId: 18 }])).toBe(2);
  });

  it("expira uma sala somente após o prazo persistido de espera", () => {
    const createdAt = new Date("2026-08-15T00:00:00.000Z");
    expect(isWaitingRoomExpired(createdAt, createdAt.getTime() + (15 * 60 * 1000) - 1)).toBe(false);
    expect(isWaitingRoomExpired(createdAt, createdAt.getTime() + (15 * 60 * 1000))).toBe(true);
  });

  it("preserva a reserva atômica da vaga de convidado", () => {
    const server = readFileSync(resolve(process.cwd(), "server/socketServer.ts"), "utf8");
    expect(server).toContain('eq(onlineRooms.status, "waiting")');
    expect(server).toContain("sql`${onlineRooms.guestId} IS NULL`");
    expect(server).toContain("reservation[0].affectedRows !== 1");
  });

  it("autoriza somente o amigo convidado em sala privada", () => {
    expect(canJoinPrivateRoom(false, null, 77)).toBe(true);
    expect(canJoinPrivateRoom(true, 77, 77)).toBe(true);
    expect(canJoinPrivateRoom(true, 77, 78)).toBe(false);
  });

  it("usa invalidação em vez de transferir o Map local como lista global de salas", () => {
    const server = readFileSync(resolve(process.cwd(), "server/socketServer.ts"), "utf8");
    const client = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");

    expect(server).toContain('io.emit("rooms_invalidated", { at: Date.now() })');
    expect(server).not.toContain('io.emit("rooms_updated", { rooms: getWaitingRoomSummaries(rooms.values()) })');
    expect(server).toContain('({ ...room, spectators: 0 })');
    expect(client).toContain("sio.on('rooms_invalidated', refreshRoomsAfterInvalidation)");
    expect(client).toContain('setInterval(refreshActiveRooms, 5000)');
  });

  it("documenta o cenário de split-brain: uma instância sem a sala local não pode publicar uma lista global", () => {
    const roomCreatedOnAnotherInstance = {
      code: "CROSS",
      hostName: "Instância A",
      mode: "1v1",
      stakeTier: "amistoso",
      region: "40",
      state: null,
      guestSocket: null,
      spectators: new Set(),
    };

    expect(getWaitingRoomSummaries([])).toEqual([]);
    expect(getWaitingRoomSummaries([roomCreatedOnAnotherInstance])).toMatchObject([{ code: "CROSS" }]);

    const server = readFileSync(resolve(process.cwd(), "server/socketServer.ts"), "utf8");
    expect(server).toContain('io.emit("rooms_invalidated", { at: Date.now() })');
    expect(server).not.toContain('rooms_updated", { rooms: getWaitingRoomSummaries(rooms.values())');
  });

  it("reproduz a invisibilidade legada quando uma lista local vazia sobrescreve a visão do cliente", () => {
    const roomPersistedByInstanceA = {
      code: "HIDE",
      hostName: "Instância A",
      mode: "1v1",
      stakeTier: "amistoso",
      region: "40",
      state: null,
      guestSocket: null,
      spectators: new Set(),
    };
    const visibleBeforeLegacyEvent = getWaitingRoomSummaries([roomPersistedByInstanceA]);
    const payloadFromInstanceBWithoutTheRoom = getWaitingRoomSummaries([]);

    expect(visibleBeforeLegacyEvent).toMatchObject([{ code: "HIDE" }]);
    expect(payloadFromInstanceBWithoutTheRoom).toEqual([]);
    // O comportamento antigo era renderizar diretamente esse payload vazio.
    expect(payloadFromInstanceBWithoutTheRoom).not.toEqual(visibleBeforeLegacyEvent);

    const client = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
    expect(client).not.toContain("renderActiveRooms(data?.rooms || [])");
    expect(client).toContain("sio.on('rooms_invalidated', refreshRoomsAfterInvalidation)");
  });
});
