import { env } from "../../../config/env.js";
import { prisma } from "../../../config/db.js";
import type {
  GatewayAdapter,
  GatewayBalanceResult,
  GatewayChargeInput,
  GatewayChargeResult,
  GatewayPayoutInput,
  GatewayPayoutResult,
  GatewayStatusResult
} from "../gateway.types.js";

type FapshiRuntimeMode = "sandbox" | "live";

type FapshiRuntime = {
  mode: FapshiRuntimeMode;
  baseUrl: string;
  apiUser: string;
  apiKey: string;
  webhookSecret: string;
};

type FapshiTransaction = {
  transId?: string;
  status?: string;
  medium?: string;
  transType?: string;
  amount?: number;
  revenue?: number;
  payerName?: string;
  email?: string;
  externalId?: string;
  userId?: string;
  reason?: string;
  financialTransId?: string;
  message?: string;
};

type FapshiInitiationResponse = {
  message?: string;
  transId?: string;
  dateInitiated?: string;
};

type FapshiBalanceResponse = {
  service?: string;
  balance?: number;
  currency?: string;
};

const MIN_FAPSHI_AMOUNT_XAF = 100;

export class FapshiGatewayAdapter implements GatewayAdapter {
  readonly provider = "FAPSHI" as const;

  private readonly staticRuntime?: FapshiRuntime;

  constructor(
    baseUrl?: string,
    apiUser?: string,
    apiKey?: string,
    webhookSecret?: string
  ) {
    if (baseUrl || apiUser || apiKey || webhookSecret) {
      this.staticRuntime = {
        mode: "sandbox",
        baseUrl: baseUrl ?? "",
        apiUser: apiUser ?? "",
        apiKey: apiKey ?? "",
        webhookSecret: webhookSecret ?? ""
      };
    }
  }

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    const validationError = validateFapshiAmount(input.amount, input.currency);
    if (validationError) {
      return failedResult(`FAPSHI-INVALID-${input.transactionId}`, validationError);
    }

    if (!input.customerPhone) {
      return failedResult(
        `FAPSHI-MISSING-PHONE-${input.transactionId}`,
        "customerPhone is required for Fapshi direct mobile money collection"
      );
    }

    const providerPhone = formatFapshiCameroonPhone(input.customerPhone);
    const response = await this.requestJson<FapshiInitiationResponse>(
      "/direct-pay",
      {
        amount: Math.round(input.amount),
        phone: providerPhone,
        medium: resolveFapshiMedium(input),
        name: input.customerName ?? undefined,
        email: input.customerEmail ?? undefined,
        userId: sanitizeFapshiReference(providerPhone),
        externalId: sanitizeFapshiReference(input.transactionId),
        message: `FlowPay ${input.externalReference}`.slice(0, 120)
      },
      "POST",
      input.runtimeMode
    );

    const providerReference = response.body.transId ?? `FAPSHI-${input.transactionId}`;

    if (!response.ok) {
      return {
        status: "FAILED",
        providerReference,
        raw: { ...response.body, httpStatus: response.status }
      };
    }

    return {
      status: mapFapshiStatus(response.body.status ?? "PENDING"),
      providerReference,
      raw: response.body
    };
  }

  async getTransactionStatus(providerReference: string, runtimeMode?: FapshiRuntimeMode | null): Promise<GatewayStatusResult> {
    const response = await this.requestJson<FapshiTransaction>(
      `/payment-status/${encodeURIComponent(providerReference)}`,
      undefined,
      "GET",
      runtimeMode
    );
    const raw = response.body;

    if (!response.ok) {
      return {
        status: "PENDING",
        providerReference,
        raw: { ...raw, httpStatus: response.status }
      };
    }

    return {
      status: mapFapshiStatus(raw.status),
      providerReference: raw.transId ?? providerReference,
      amount: readPositiveNumber(raw.amount),
      currency: "XAF",
      raw
    };
  }

  async executePayout(input: GatewayPayoutInput): Promise<GatewayPayoutResult> {
    const validationError = validateFapshiAmount(input.amount, input.currency);
    if (validationError) {
      return {
        status: "FAILED",
        providerReference: `FAPSHI-PAYOUT-INVALID-${input.payoutCoordinationId}`,
        raw: { message: validationError }
      };
    }

    const providerPhone = formatFapshiCameroonPhone(input.payoutTarget);
    const response = await this.requestJson<FapshiInitiationResponse>(
      "/payout",
      {
        amount: Math.round(input.amount),
        phone: providerPhone,
        medium: resolveFapshiPayoutMedium(input),
        externalId: sanitizeFapshiReference(input.idempotencyKey),
        userId: sanitizeFapshiReference(input.destinationProfileId ?? input.transactionId),
        message: `FlowPay payout ${input.transactionId}`.slice(0, 120)
      },
      "POST",
      input.runtimeMode
    );

    const providerReference = response.body.transId ?? `FAPSHI-PAYOUT-${input.payoutCoordinationId}`;

    if (!response.ok) {
      return {
        status: "FAILED",
        providerReference,
        raw: { ...response.body, httpStatus: response.status }
      };
    }

    return {
      status: mapFapshiStatus(response.body.status ?? "PENDING"),
      providerReference,
      raw: response.body
    };
  }

  async getBalance(): Promise<GatewayBalanceResult> {
    const response = await this.requestJson<FapshiBalanceResponse>("/balance", undefined, "GET");
    if (!response.ok) {
      throw new Error(`Fapshi balance request failed (${response.status})`);
    }

    return {
      service: response.body.service,
      balance: response.body.balance,
      currency: response.body.currency,
      raw: response.body
    };
  }

  verifyWebhookSignature(_payload: string, signature?: string) {
    if (!signature) return false;

    return webhookSecrets(this.staticRuntime?.webhookSecret).some((secret) => secret === signature);
  }

  private async requestJson<T>(
    path: string,
    body?: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
    runtimeMode?: FapshiRuntimeMode | null
  ): Promise<{ ok: boolean; status: number; body: T & Record<string, unknown> }> {
    const runtime = await this.resolveRuntime(runtimeMode);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.GATEWAY_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${runtime.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          apiuser: runtime.apiUser,
          apikey: runtime.apiKey,
          "Content-Type": "application/json"
        },
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        signal: controller.signal
      });

      const parsed = (await response.json().catch(() => ({}))) as T & Record<string, unknown>;
      return {
        ok: response.ok,
        status: response.status,
        body: parsed
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveRuntime(runtimeMode?: FapshiRuntimeMode | null) {
    return this.staticRuntime ?? resolveFapshiRuntime(runtimeMode);
  }
}

function failedResult(providerReference: string, message: string): GatewayChargeResult {
  return {
    status: "FAILED",
    providerReference,
    raw: { message }
  };
}

function validateFapshiAmount(amount: number, currency: string) {
  if (currency !== "XAF") {
    return "Fapshi currently supports XAF transactions only";
  }

  if (!Number.isFinite(amount) || amount < MIN_FAPSHI_AMOUNT_XAF) {
    return `Fapshi requires a minimum amount of ${MIN_FAPSHI_AMOUNT_XAF} XAF`;
  }

  if (!Number.isInteger(amount)) {
    return "Fapshi requires integer XAF amounts";
  }

  return null;
}

function resolveFapshiMedium(input: GatewayChargeInput) {
  if (input.paymentMethod === "ORANGE_MONEY") return "orange money";
  if (input.paymentMethod === "MTN_MOMO") return "mobile money";

  const reference = `${input.externalReference} ${input.transactionId}`.toLowerCase();
  if (reference.includes("orange")) return "orange money";
  return "mobile money";
}

function resolveFapshiPayoutMedium(input: GatewayPayoutInput) {
  const metadataMedium = input.metadata?.medium;
  if (metadataMedium === "orange money" || metadataMedium === "mobile money" || metadataMedium === "fapshi") {
    return metadataMedium;
  }

  return "mobile money";
}

function formatFapshiCameroonPhone(value: string) {
  const compact = value.trim().replace(/[\s().-]+/g, "");

  if (/^\+2376\d{8}$/.test(compact)) {
    return compact.slice(4);
  }

  if (/^2376\d{8}$/.test(compact)) {
    return compact.slice(3);
  }

  return compact;
}

function mapFapshiStatus(status: unknown): GatewayChargeResult["status"] {
  const normalized = String(status ?? "").toUpperCase();
  if (normalized.includes("SUCCESS")) return "SUCCESS";
  if (normalized.includes("FAIL") || normalized.includes("EXPIRED") || normalized.includes("CANCEL")) return "FAILED";
  return "PENDING";
}

function readPositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sanitizeFapshiReference(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 100);
}

export function createFapshiAdapter() {
  if (!env.FAPSHI_HAS_LIVE_CREDENTIALS && !env.FAPSHI_HAS_SANDBOX_CREDENTIALS) {
    return null;
  }

  return new FapshiGatewayAdapter();
}

async function resolveFapshiRuntime(runtimeMode?: FapshiRuntimeMode | null): Promise<FapshiRuntime> {
  const mode = runtimeMode ?? (await readFapshiModeFromProviderConfig());

  if (mode === "live") {
    if (!env.FAPSHI_LIVE_API_USER || !env.FAPSHI_LIVE_API_KEY) {
      throw new Error("Fapshi live mode is enabled but live credentials are not configured");
    }

    return {
      mode,
      baseUrl: env.FAPSHI_LIVE_BASE_URL,
      apiUser: env.FAPSHI_LIVE_API_USER,
      apiKey: env.FAPSHI_LIVE_API_KEY,
      webhookSecret: env.FAPSHI_LIVE_WEBHOOK_SECRET
    };
  }

  if (!env.FAPSHI_SANDBOX_API_USER || !env.FAPSHI_SANDBOX_API_KEY) {
    throw new Error("Fapshi sandbox mode is enabled but sandbox credentials are not configured");
  }

  return {
    mode,
    baseUrl: env.FAPSHI_SANDBOX_BASE_URL,
    apiUser: env.FAPSHI_SANDBOX_API_USER,
    apiKey: env.FAPSHI_SANDBOX_API_KEY,
    webhookSecret: env.FAPSHI_SANDBOX_WEBHOOK_SECRET ?? env.FAPSHI_WEBHOOK_SECRET
  };
}

async function readFapshiModeFromProviderConfig(): Promise<FapshiRuntimeMode> {
  try {
    const config = await prisma.gatewayConfig.findUnique({
      where: { provider: "FAPSHI" },
      select: { metadata: true }
    });
    const metadata = asRecord(config?.metadata);
    return metadata.mode === "live" ? "live" : "sandbox";
  } catch {
    return "sandbox";
  }
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function webhookSecrets(staticSecret?: string) {
  return [
    staticSecret,
    env.FAPSHI_LIVE_WEBHOOK_SECRET,
    env.FAPSHI_SANDBOX_WEBHOOK_SECRET,
    env.FAPSHI_WEBHOOK_SECRET,
    env.WEBHOOK_SIGNING_SECRET
  ].filter((secret): secret is string => Boolean(secret));
}
