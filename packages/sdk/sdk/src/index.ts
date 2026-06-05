export type FlowPayInitializeOptions = {
  publicKey: string;
  amount: number;
  currency: string;
  externalReference: string;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  metadata?: Record<string, unknown>;
};

export class FlowPayClient {
  constructor(private readonly apiBaseUrl: string, private readonly publicKey: string) {}

  createHostedCheckoutUrl(transactionId: string, sessionToken: string) {
    const params = new URLSearchParams({ token: sessionToken });
    return `${this.apiBaseUrl.replace(/\/$/, "")}/checkout/${transactionId}?${params.toString()}`;
  }
}
