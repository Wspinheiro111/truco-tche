import { createHmac, timingSafeEqual } from "node:crypto";
import { MercadoPagoConfig, Payment } from "mercadopago";

const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN ?? "";

let _client: MercadoPagoConfig | null = null;

function getClient(): MercadoPagoConfig {
  if (!_client) {
    if (!ACCESS_TOKEN) {
      throw new Error("MERCADO_PAGO_ACCESS_TOKEN not configured");
    }
    _client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
  }
  return _client;
}

/**
 * Validate Mercado Pago's x-signature header.
 *
 * Mercado Pago signs the manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * with the webhook secret using HMAC-SHA256 and sends the result as `v1`.
 */
export function verifyMercadoPagoWebhookSignature(params: {
  signature: string | string[] | undefined;
  requestId: string | string[] | undefined;
  dataId: string | number | null | undefined;
  secret?: string;
}): boolean {
  const signatureHeader = Array.isArray(params.signature)
    ? params.signature[0]
    : params.signature;
  const requestId = Array.isArray(params.requestId)
    ? params.requestId[0]
    : params.requestId;
  const secret = params.secret ?? process.env.MERCADO_PAGO_WEBHOOK_SECRET ?? "";

  if (!secret || !signatureHeader || !requestId || params.dataId === undefined || params.dataId === null) {
    return false;
  }

  const parts = new Map<string, string>();
  for (const part of signatureHeader.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    parts.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }

  const ts = parts.get("ts");
  const receivedHash = parts.get("v1");
  if (!ts || !receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return false;
  }

  const manifest = `id:${String(params.dataId)};request-id:${requestId};ts:${ts};`;
  const expectedHash = createHmac("sha256", secret).update(manifest).digest("hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const receivedBuffer = Buffer.from(receivedHash, "hex");

  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Create a Pix payment via Mercado Pago API.
 * Returns the payment ID, QR code, and ticket URL.
 */
export async function createPixPayment(params: {
  amountBRL: number;
  description: string;
  payerEmail: string;
  idempotencyKey: string;
  expirationMinutes?: number;
}) {
  const client = getClient();
  const payment = new Payment(client);

  const expirationDate = new Date();
  expirationDate.setMinutes(
    expirationDate.getMinutes() + (params.expirationMinutes ?? 30)
  );

  const result = await payment.create({
    body: {
      transaction_amount: params.amountBRL,
      payment_method_id: "pix",
      description: params.description,
      payer: {
        email: params.payerEmail,
      },
      date_of_expiration: expirationDate.toISOString(),
    },
    requestOptions: {
      idempotencyKey: params.idempotencyKey,
    },
  });

  if (!result.id) {
    throw new Error("Failed to create Pix payment");
  }

  const txData = result.point_of_interaction?.transaction_data;

  return {
    paymentId: String(result.id),
    status: result.status ?? "pending",
    qrCode: txData?.qr_code ?? null,
    qrCodeBase64: txData?.qr_code_base64 ?? null,
    ticketUrl: txData?.ticket_url ?? null,
    expiresAt: expirationDate,
  };
}

/**
 * Check the status of a payment via Mercado Pago API.
 */
export async function getPaymentStatus(paymentId: string) {
  const client = getClient();
  const payment = new Payment(client);

  const result = await payment.get({ id: paymentId });

  return {
    id: String(result.id),
    status: result.status ?? "pending",
    statusDetail: result.status_detail ?? "",
  };
}
