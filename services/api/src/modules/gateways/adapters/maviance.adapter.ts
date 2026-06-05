import { env } from "../../../config/env.js";
import type { GatewayAdapter, GatewayChargeInput, GatewayChargeResult } from "../gateway.types.js";

/**
 * Maviance (Smobilpay) adapter skeleton — finalize against your Maviance sandbox contract.
 */
export class MavianceGatewayAdapter implements GatewayAdapter {
  readonly provider = "MAVIANCE" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly secret: string
  ) {}

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "X-Api-Secret": this.secret
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        reference: input.transactionId,
        customerPhone: input.customerPhone,
        callbackUrl: env.gatewayWebhookUrl("MAVIANCE")
      })
    });

    const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      return {
        status: "FAILED",
        providerReference: `MAVIANCE-ERR-${input.transactionId}`,
        raw: { ...raw, httpStatus: response.status }
      };
    }

    return {
      status: "PENDING",
      providerReference: String(raw.reference ?? raw.id ?? input.transactionId),
      raw
    };
  }

  verifyWebhookSignature(_payload: string, signature?: string) {
    return Boolean(signature && env.MAVIANCE_SECRET_KEY);
  }
}

export function createMavianceAdapter() {
  if (!env.MAVIANCE_API_KEY || !env.MAVIANCE_SECRET_KEY) {
    return null;
  }

  return new MavianceGatewayAdapter(env.MAVIANCE_BASE_URL, env.MAVIANCE_API_KEY, env.MAVIANCE_SECRET_KEY);
}
