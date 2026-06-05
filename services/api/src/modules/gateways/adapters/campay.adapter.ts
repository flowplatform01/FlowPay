import { env } from "../../../config/env.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import https from "node:https";
import type {
  GatewayAdapter,
  GatewayChargeInput,
  GatewayChargeResult,
  GatewayPayoutInput,
  GatewayPayoutResult,
  GatewayStatusResult
} from "../gateway.types.js";

type CampayTokenResponse = {
  token?: string;
  access_token?: string;
};

type CampayCollectResponse = {
  reference?: string;
  ussd_code?: string;
  status?: string;
  message?: string;
  amount?: number | string;
  currency?: string;
};

type CampayWithdrawResponse = {
  reference?: string;
  external_reference?: string;
  status?: string;
  message?: string;
  amount?: number | string;
  currency?: string;
  operator?: string;
  code?: string;
  operator_reference?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

export class CampayGatewayAdapter implements GatewayAdapter {
  readonly provider = "CAMPAY" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly webhookSecret: string,
    private readonly permanentToken?: string
  ) { }

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    if (!input.customerPhone) {
      return {
        status: "FAILED",
        providerReference: `CAMPAY-MISSING-PHONE-${input.transactionId}`,
        raw: { message: "customerPhone is required for CamPay mobile money collection" }
      };
    }

    const token = await this.getAccessToken();
    const response = await requestJson<CampayCollectResponse & Record<string, unknown>>(`${this.baseUrl.replace(/\/$/, "")}/api/collect/`, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json"
      },
      body: {
        amount: String(input.amount),
        currency: input.currency,
        from: input.customerPhone,
        description: `FlowPay ${input.externalReference}`,
        external_reference: input.transactionId,
        payment_type: "mobile_money"
      }
    });

    const raw = response.body;

    if (!response.ok) {
      return {
        status: "FAILED",
        providerReference: raw.reference?.toString() ?? `CAMPAY-ERR-${input.transactionId}`,
        raw: { ...raw, httpStatus: response.status }
      };
    }

    const providerReference = raw.reference?.toString() ?? `CAMPAY-${input.transactionId}`;
    const gatewayStatus = (raw.status ?? "PENDING").toString().toUpperCase();

    return {
      status: gatewayStatus.includes("SUCCESS") ? "SUCCESS" : gatewayStatus.includes("FAIL") ? "FAILED" : "PENDING",
      providerReference,
      raw
    };
  }

  verifyWebhookSignature(payload: string, signature?: string) {
    if (!signature || !this.webhookSecret) {
      return false;
    }

    const expected = createHmac("sha256", this.webhookSecret).update(payload).digest("hex");
    const provided = signature.replace(/^sha256=/i, "");

    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch {
      return expected === provided;
    }
  }

  async getTransactionStatus(providerReference: string): Promise<GatewayStatusResult> {
    const token = await this.getAccessToken();
    const response = await requestJson<CampayCollectResponse & Record<string, unknown>>(`${this.baseUrl.replace(/\/$/, "")}/api/transaction/${providerReference}/`, {
      method: "GET",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json"
      }
    });

    const raw = response.body;

    if (!response.ok) {
      return {
        status: "PENDING",
        providerReference,
        raw: { ...raw, httpStatus: response.status }
      };
    }

    return {
      status: mapCampayStatus(raw.status),
      providerReference: raw.reference?.toString() ?? providerReference,
      amount: readAuthoritativeAmount(raw.app_amount ?? raw.amount),
      currency: raw.currency,
      raw
    };
  }

  async executePayout(input: GatewayPayoutInput): Promise<GatewayPayoutResult> {
    const token = await this.getAccessToken();
    const response = await requestJson<CampayWithdrawResponse & Record<string, unknown>>(
      `${this.baseUrl.replace(/\/$/, "")}/api/withdraw/`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json"
        },
        body: {
          amount: String(input.amount),
          currency: input.currency,
          to: input.payoutTarget,
          description: `FlowPay payout ${input.transactionId}`,
          external_reference: input.idempotencyKey
        }
      }
    );

    const raw = response.body;
    const providerReference = raw.reference?.toString() ?? `CAMPAY-PAYOUT-${input.payoutCoordinationId}`;

    if (!response.ok) {
      return {
        status: "FAILED",
        providerReference,
        raw: { ...raw, httpStatus: response.status }
      };
    }

    return {
      status: mapCampayStatus(raw.status),
      providerReference,
      raw
    };
  }

  private async getAccessToken() {
    if (this.permanentToken) {
      return this.permanentToken;
    }

    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.value;
    }

    const response = await requestJson<CampayTokenResponse>(`${this.baseUrl.replace(/\/$/, "")}/api/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        username: this.username,
        password: this.password
      }
    });

    const body = response.body;

    if (!response.ok) {
      throw new Error(`CamPay token request failed (${response.status})`);
    }

    const token = body.token ?? body.access_token;
    if (!token) {
      throw new Error("CamPay token response did not include a token");
    }

    cachedToken = {
      value: token,
      expiresAt: Date.now() + 50 * 60 * 1000
    };

    return token;
  }
}

function requestJson<T>(
  url: string,
  options: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  }
): Promise<{ ok: boolean; status: number; body: T & Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = options.body ? JSON.stringify(options.body) : undefined;
    const request = https.request(
      url,
      {
        method: options.method,
        headers: {
          ...(options.headers ?? {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {})
        },
        timeout: env.GATEWAY_REQUEST_TIMEOUT_MS
      },
      (response) => {
        let responseText = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseText += chunk;
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          let body: Record<string, unknown> = {};
          try {
            body = responseText ? JSON.parse(responseText) : {};
          } catch {
            body = { rawBody: responseText };
          }

          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: body as T & Record<string, unknown>
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("CamPay request timed out"));
    });
    request.on("error", reject);

    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function mapCampayStatus(status: unknown): GatewayChargeResult["status"] {
  const normalized = String(status ?? "").toUpperCase();

  if (normalized.includes("SUCCESS")) return "SUCCESS";
  if (normalized.includes("FAIL")) return "FAILED";

  return "PENDING";
}

function readAuthoritativeAmount(amount: unknown) {
  if (amount === undefined || amount === null) return undefined;

  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

  return parsed;
}

export function createCampayAdapter() {
  const permanentToken = env.CAMPAY_ACCESS_TOKEN?.trim();
  const username = env.CAMPAY_USERNAME || env.CAMPAY_PUBLIC_KEY;
  const password = env.CAMPAY_PASSWORD || env.CAMPAY_SECRET_KEY;

  if (!permanentToken && (!username || !password)) {
    return null;
  }

  return new CampayGatewayAdapter(
    env.CAMPAY_BASE_URL,
    username || "unused",
    password || "unused",
    env.CAMPAY_WEBHOOK_SECRET || env.WEBHOOK_SIGNING_SECRET,
    env.CAMPAY_ACCESS_TOKEN || undefined
  );
}
