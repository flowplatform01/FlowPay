import { Queue } from "bullmq";
import {
  createRedisConnection,
  isRedisCircuitOpen,
  isRedisQuotaError,
  openRedisCircuit
} from "../config/redis.js";

const defaultJobOptions = {
  attempts: 6,
  backoff: {
    type: "exponential" as const,
    delay: 5_000
  },
  removeOnComplete: 1_000,
  removeOnFail: 5_000
};

const retryQueueConnection = createRedisConnection("queue:retry");
const webhookQueueConnection = createRedisConnection("queue:webhook");
const chargeQueueConnection = createRedisConnection("queue:charge");

export const retryQueue = retryQueueConnection
  ? new Queue("retry-queue", {
      connection: retryQueueConnection,
      defaultJobOptions
    })
  : null;

export const webhookQueue = webhookQueueConnection
  ? new Queue("webhook-queue", {
      connection: webhookQueueConnection,
      defaultJobOptions
    })
  : null;

export const chargeQueue = chargeQueueConnection
  ? new Queue("charge-queue", {
      connection: chargeQueueConnection,
      defaultJobOptions
    })
  : null;

export async function addQueueJobSafely(
  label: string,
  enqueue: () => Promise<unknown>
): Promise<{ enqueued: boolean; reason?: string }> {
  if (isRedisCircuitOpen()) {
    return {
      enqueued: false,
      reason: "Redis circuit is open"
    };
  }

  try {
    await enqueue();
    return { enqueued: true };
  } catch (error) {
    if (isRedisQuotaError(error)) {
      openRedisCircuit(label, error);
    }

    return {
      enqueued: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}
