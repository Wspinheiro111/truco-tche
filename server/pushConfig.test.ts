import { describe, expect, it, vi } from "vitest";
import { getPublicPushConfig, pushConfigHandler } from "./pushConfig";

describe("push configuration endpoint", () => {
  it("returns the configured public VAPID key without exposing the private key", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    pushConfigHandler({} as never, { status, json } as never);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ vapidPublicKey: getPublicPushConfig().vapidPublicKey });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("PRIVATE");
  });
});
