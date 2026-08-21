import { describe, expect, it } from "vitest";
import { canUseRoomScope, isLoopbackSocketAddress, parseLocalSocketAuthPayload } from "./socketSecurity";

describe("guardas de segurança Socket.IO", () => {
  it("rejeita identidades locais ausentes, inválidas ou excessivamente longas", () => {
    expect(parseLocalSocketAuthPayload(undefined)).toBeNull();
    expect(parseLocalSocketAuthPayload({ userId: 0, userName: "Gaudério" })).toBeNull();
    expect(parseLocalSocketAuthPayload({ userId: 3.5, userName: "Gaudério" })).toBeNull();
    expect(parseLocalSocketAuthPayload({ userId: 3, userName: " " })).toBeNull();
    expect(parseLocalSocketAuthPayload({ userId: 3, userName: "x".repeat(101) })).toBeNull();
  });

  it("normaliza uma identidade local válida sem confiar em valores implícitos", () => {
    expect(parseLocalSocketAuthPayload({ userId: "42", userName: "  Prenda  " })).toEqual({ userId: 42, userName: "Prenda" });
  });

  it("restringe o fallback local a endereços de loopback", () => {
    expect(isLoopbackSocketAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackSocketAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackSocketAddress("10.0.0.15")).toBe(false);
    expect(isLoopbackSocketAddress("198.51.100.22")).toBe(false);
  });

  it("impede que um socket autenticado use outra sala enquanto mantém reconexão na mesma sala", () => {
    expect(canUseRoomScope(undefined, "ABCD")).toBe(true);
    expect(canUseRoomScope("ABCD", "ABCD")).toBe(true);
    expect(canUseRoomScope("ABCD", "WXYZ")).toBe(false);
  });
});
