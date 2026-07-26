/**
 * Queue (Producer) — BullMQ Job Producer
 *
 * This is the producer service that adds jobs to a BullMQ queue stored in Redis.
 * It runs on a timer and creates "order" jobs that a separate Consumer worker
 * will pick up and process.
 *
 * BullMQ concepts demonstrated here:
 * - Queue: The entry point for adding jobs
 * - Job options: attempts, delay, priority
 * - Connection management with Redis
 */

import { Queue } from 'bullmq';
import { ENV } from '@bull/config';
import { ConnectionOptionType } from '@bull/shared-types';

/**
 * Load environment variables from the shared config package.
 *
 * ENV reads from process.env which is populated by dotenv
 * (via the .env file in this app's directory).
 */
const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  QUEUE_NAME,
} = ENV;

/**
 * Validate that all required environment variables are present.
 * BullMQ will fail at runtime if it cannot connect to Redis or
 * if no queue name is provided, so we fail fast here.
 */
if (!REDIS_HOST || !REDIS_PORT || !REDIS_PASSWORD || !QUEUE_NAME) {
  throw new Error('Missing required environment variable');
}

/**
 * Build the Redis connection configuration.
 *
 * REDIS_PORT comes from process.env as a string (e.g. "6379"),
 * so we parse it to a number to match the ConnectionOptionType interface.
 *
 * The same connection object can be reused across Queue, Worker,
 * and QueueEvents instances.
 */
const connection: ConnectionOptionType = {
  host: REDIS_HOST,
  port: parseInt(REDIS_PORT, 10),
  password: REDIS_PASSWORD
};

/**
 * Create a BullMQ Queue instance.
 *
 * The Queue is a lightweight class used to add and manage jobs.
 * This does NOT create a worker — it ONLY produces jobs that
 * a separate Consumer (worker) will process.
 *
 * The generic type parameter defines the shape of the job data
 * that this queue will accept, giving us full TypeScript type safety.
 */
const queue = new Queue<{ task: string; order_id: number; user_id: number; amount: number }>(
  QUEUE_NAME,
  { connection },
);

/**
 * Add a job to the BullMQ queue for processing.
 *
 * @param data - The job payload containing task details
 *
 * Job options explained:
 *   attempts: 3  — If the worker throws an error, retry up to 3 times
 *                  before marking the job as permanently failed
 *   delay: 1000  — Wait at least 1 second before the job becomes available
 *                  to workers (useful for debouncing or staggering)
 *   priority: 1  — Lower numbers = higher priority. Jobs with priority 0
 *                  (or no priority) are processed before prioritized jobs.
 *                  Range: 1 to 2,097,151
 */
export const addJobToQueue = async (data: { task: string; order_id: number; user_id: number; amount: number }) => {
  await queue.add('orderJob', data, {
    attempts: 3,
    delay: 1000,
    priority: 1,
  });
};

/**
 * Self-executing async function that runs when this file starts.
 *
 * Every 5 seconds, it generates a random order and adds it to the queue.
 * This simulates a real producer (e.g. an order processing pipeline)
 * that would normally be triggered by HTTP requests or events.
 */
(async () => {
  setInterval(
    () => addJobToQueue({
      task: 'job',
      order_id: Math.floor(Math.random() * 1000),
      user_id: 100,
      amount: 100,
    }),
    5000,
  );
})();
