import { Queue, Worker, Job } from "bullmq";
import { redis } from "./redis.js";

const PROVISION_QUEUE_NAME = "provision";

export const provisionQueue = new Queue(PROVISION_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 10,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

interface ProvisionJob {
  rentalId: string;
  protocol?: string;
  durationHours?: number;
  action?: "destroy";
  vpsId?: string;
  ip?: string;
}

export async function addProvisionJob(data: ProvisionJob) {
  return provisionQueue.add(PROVISION_QUEUE_NAME, data);
}

export function createProvisionWorker(
  processor: (job: Job<ProvisionJob>) => Promise<void>
) {
  return new Worker<ProvisionJob>(PROVISION_QUEUE_NAME, processor, {
    connection: redis,
    concurrency: 5,
  });
}
