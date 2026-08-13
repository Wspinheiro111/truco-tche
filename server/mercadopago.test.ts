import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMercadoPagoWebhookSignature } from "./mercadopago";

function signatureFor(secret: string, dataId: string, requestId: string, ts: string) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hash = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${hash}`;
}

describe("Mercado Pago webhook signature", () => {
  it("accepts a valid x-signature", () => {
    const secret = "webhook-secret";
    const dataId = "123456";
    const requestId = "req-abc";
    const ts = "1710000000";

    expect(verifyMercadoPagoWebhookSignature({
      secret,
      dataId,
      requestId,
      signature: signatureFor(secret, dataId, requestId, ts),
    })).toBe(true);
  });

  it("rejects a signature generated with another payload", () => {
    const secret = "webhook-secret";
    const signature = signatureFor(secret, "123456", "req-abc", "1710000000");

    expect(verifyMercadoPagoWebhookSignature({
      secret,
      dataId: "999999",
      requestId: "req-abc",
      signature,
    })).toBe(false);
  });

  it("rejects missing signature metadata", () => {
    expect(verifyMercadoPagoWebhookSignature({
      secret: "webhook-secret",
      dataId: "123456",
      requestId: "req-abc",
      signature: undefined,
    })).toBe(false);
  });
});
