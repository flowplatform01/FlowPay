import type { GatewayProvider } from "@prisma/client";

export type GatewayChargePhase = "authorize" | "capture";

export type GatewayChargeInput = {
  transactionId: string;
  amount: number;
  currency: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  externalReference: string;
  phase?: GatewayChargePhase;
};

export type GatewayChargeResult = {
  status: "PENDING" | "SUCCESS" | "FAILED";
  providerReference: string;
  raw: Record<string, unknown>;
};

export type GatewayStatusResult = GatewayChargeResult & {
  amount?: number;
  currency?: string;
};

export type GatewayPayoutInput = {
  transactionId: string;
  payoutCoordinationId: string;
  destinationProfileId?: string | null;
  payoutTarget: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type GatewayPayoutResult = {
  status: "PENDING" | "SUCCESS" | "FAILED";
  providerReference?: string;
  raw: Record<string, unknown>;
};

export interface GatewayAdapter {
  provider: GatewayProvider;
  charge(input: GatewayChargeInput): Promise<GatewayChargeResult>;
  getTransactionStatus?(providerReference: string): Promise<GatewayStatusResult>;
  executePayout?(input: GatewayPayoutInput): Promise<GatewayPayoutResult>;
  verifyWebhookSignature(payload: string, signature?: string): boolean;
}
