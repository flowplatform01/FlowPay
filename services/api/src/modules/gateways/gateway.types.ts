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
  paymentMethod?: string | null;
  runtimeMode?: "sandbox" | "live" | null;
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
  runtimeMode?: "sandbox" | "live" | null;
  metadata?: Record<string, unknown>;
};

export type GatewayPayoutResult = {
  status: "PENDING" | "SUCCESS" | "FAILED";
  providerReference?: string;
  raw: Record<string, unknown>;
};

export type GatewayBalanceResult = {
  service?: string;
  balance?: number;
  currency?: string;
  raw?: Record<string, unknown>;
};

export interface GatewayAdapter {
  provider: GatewayProvider;
  charge(input: GatewayChargeInput): Promise<GatewayChargeResult>;
  getTransactionStatus?(providerReference: string, runtimeMode?: "sandbox" | "live" | null): Promise<GatewayStatusResult>;
  executePayout?(input: GatewayPayoutInput): Promise<GatewayPayoutResult>;
  getBalance?(): Promise<GatewayBalanceResult>;
  verifyWebhookSignature(payload: string, signature?: string): boolean;
}
