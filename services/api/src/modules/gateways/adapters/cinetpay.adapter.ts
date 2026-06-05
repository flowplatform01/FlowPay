import { env } from "../../../config/env.js";
import type { GatewayAdapter, GatewayChargeInput, GatewayChargeResult } from "../gateway.types.js";

/**
 * CinetPay adapter skeleton — wire to official CinetPay v2 init/payment endpoints
 * once sandbox API key, site ID, and notify URL are available.
 */
export class CinetpayGatewayAdapter implements GatewayAdapter {
  readonly provider = "CINETPAY" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly siteId: string
  ) {}

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v2/payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: this.apiKey,
        site_id: this.siteId,
        transaction_id: input.transactionId,
        amount: input.amount,
        currency: input.currency,
        description: input.externalReference,
        notify_url: env.gatewayWebhookUrl("CINETPAY"),
        return_url: `${env.FLOWPAY_PUBLIC_URL}/checkout/${input.transactionId}`,
        customer_phone_number: input.customerPhone,
        customer_email: input.customerEmail,
        customer_name: input.customerName
      })
    });

    const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      return {
        status: "FAILED",
        providerReference: `CINETPAY-ERR-${input.transactionId}`,
        raw: { ...raw, httpStatus: response.status }
      };
    }

    const code = String(raw.code ?? "");
    const providerReference = String(raw.payment_token ?? raw.transaction_id ?? input.transactionId);

    return {
      status: code === "201" || code === "200" ? "PENDING" : "FAILED",
      providerReference,
      raw
    };
  }

  verifyWebhookSignature(_payload: string, signature?: string) {
    return Boolean(signature && env.CINETPAY_SECRET_KEY);
  }
}

export function createCinetpayAdapter() {
  const apiKey = env.CINETPAY_API_KEY || env.CINETPAY_PUBLIC_KEY;
  if (!apiKey || !env.CINETPAY_SITE_ID) {
    return null;
  }

  return new CinetpayGatewayAdapter(env.CINETPAY_BASE_URL, apiKey, env.CINETPAY_SITE_ID);
}
