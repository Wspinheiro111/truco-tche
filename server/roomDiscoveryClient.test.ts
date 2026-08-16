import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
const handlerStart = html.indexOf("function refreshRoomsAfterInvalidation()");
const handlerEnd = html.indexOf("sio.on('rooms_invalidated'", handlerStart);
if (handlerStart < 0 || handlerEnd < 0) throw new Error("Handler de invalidação de salas não encontrado");
const invalidationHandler = html.slice(handlerStart, handlerEnd);

describe("room discovery client regression", () => {
  it("reproduz a perda de visibilidade do fluxo legado e executa o handler atual sem transferir a lista local", () => {
    const persistedRoom = { code: "CROSS", hostName: "Instância A" };
    let legacyRenderedRooms = [persistedRoom];

    // Comportamento legado do listener rooms_updated: substituir a lista exibida
    // pelo payload do Map local de outra instância, que pode estar vazio.
    const legacyRoomsUpdated = (data: { rooms?: typeof persistedRoom[] }) => {
      legacyRenderedRooms = data.rooms || [];
    };
    legacyRoomsUpdated({ rooms: [] });
    expect(legacyRenderedRooms).toEqual([]);

    const refreshActiveRooms = vi.fn();
    const refreshHomeActiveRooms = vi.fn();
    const sandbox: Record<string, unknown> = {
      document: { getElementById: vi.fn(() => ({ style: { display: "block" } })) },
      refreshActiveRooms,
      refreshHomeActiveRooms,
    };
    sandbox.window = sandbox;
    vm.runInNewContext(`${invalidationHandler}; globalThis.invalidateRooms = refreshRoomsAfterInvalidation;`, sandbox);
    (sandbox.invalidateRooms as () => void)();

    expect(refreshActiveRooms).toHaveBeenCalledTimes(1);
    expect(refreshHomeActiveRooms).not.toHaveBeenCalled();
    expect(html).not.toContain("renderActiveRooms(data?.rooms || [])");
    expect(html).toContain("sio.on('rooms_invalidated', refreshRoomsAfterInvalidation)");
  });
});
