import type { GatewayProvider } from "@prisma/client";
import { signPayload } from "../../../utils/crypto.js";
import type {
  GatewayAdapter,
  GatewayChargeInput,
  GatewayChargeResult,
  GatewayPayoutInput,
  GatewayPayoutResult,
  GatewayStatusResult
} from "../gateway.types.js";

export class SandboxGatewayAdapter implements GatewayAdapter {
  constructor(
    public provider: GatewayProvider,
    private secret: string
  ) {}

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    const reference = input.externalReference.toLowerCase();
    const status =
      reference.includes("fail")
        ? "FAILED"
        : input.phase === "capture"
          ? "SUCCESS"
          : reference.includes("success")
            ? "SUCCESS"
            : "PENDING";

    return {
      status,
      providerReference: `${this.provider}-${input.transactionId}`,
      raw: {
        accepted: status !== "FAILED",
        status,
        amount: input.amount,
        currency: input.currency,
        mode: "internal-sandbox"
      }
    };
  }

  async getTransactionStatus(providerReference: string): Promise<GatewayStatusResult> {
    const status = providerReference.toLowerCase().includes("fail") ? "FAILED" : "SUCCESS";

    return {
      status,
      providerReference,
      raw: {
        reference: providerReference,
        status,
        mode: "internal-sandbox"
      }
    };
  }

  async executePayout(input: GatewayPayoutInput): Promise<GatewayPayoutResult> {
    const shouldFail = input.payoutTarget.toLowerCase().includes("fail");

    return {
      status: shouldFail ? "FAILED" : "SUCCESS",
      providerReference: `${this.provider}-PAYOUT-${input.payoutCoordinationId}`,
      raw: {
        accepted: !shouldFail,
        status: shouldFail ? "FAILED" : "SUCCESS",
        amount: input.amount,
        currency: input.currency,
        destinationProfileId: input.destinationProfileId,
        payoutTarget: maskPayoutTarget(input.payoutTarget),
        mode: "internal-sandbox"
      }
    };
  }

  verifyWebhookSignature(payload: string, signature?: string) {
    if (!signature) {
      return false;
    }

    return signPayload(payload, this.secret) === signature;
  }
}

function maskPayoutTarget(value: string) {
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}
