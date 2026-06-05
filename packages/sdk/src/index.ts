export type FlowPayProvider = "CAMPAY" | "MAVIANCE" | "CINETPAY" | "FLUTTERWAVE" | "MONETBIL";

export type InitializePaymentInput = {
  amount: number;
  currency: string;
  provider: FlowPayProvider;
  externalReference: string;
  idempotencyKey?: string;
  externalRecipientId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  metadata?: Record<string, unknown>;
  deferCapture?: boolean;
};

export type ProvisionDestinationProfileInput = {
  externalRecipientId: string;
  providerType: FlowPayProvider;
  payoutTarget: string;
  settlementStrategy?: string;
  regionalCurrency?: string;
};

export type DestinationProfileResponse = {
  id: string;
  externalRecipientId: string;
  providerType: FlowPayProvider;
  settlementStrategy: string;
  verificationStatus: "VERIFIED" | "PENDING" | "REJECTED";
  regionalCurrency: string;
  createdAt: string;
  updatedAt: string;
  confirmationUrl?: string;
};

export type FlowPayClientOptions = {
  baseUrl: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
};

export class FlowPayClient {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FlowPayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.secretKey = options.secretKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async initializePayment<TResponse = unknown>(input: InitializePaymentInput): Promise<TResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/payments/initialize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.secretKey}`
      },
      body: JSON.stringify(input)
    });

    const payload = await readJsonSafely(response);

    if (!response.ok) {
      throw new FlowPayApiError(response.status, payload);
    }

    return payload as TResponse;
  }

  async provisionDestinationProfile(input: ProvisionDestinationProfileInput): Promise<DestinationProfileResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/destination-profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.secretKey}`
      },
      body: JSON.stringify(input)
    });

    const payload = await readJsonSafely(response);

    if (!response.ok) {
      throw new FlowPayApiError(response.status, payload);
    }

    return payload as DestinationProfileResponse;
  }
}

export class FlowPayApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly payload: unknown
  ) {
    super(`FlowPay API request failed with HTTP ${statusCode}`);
  }
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
