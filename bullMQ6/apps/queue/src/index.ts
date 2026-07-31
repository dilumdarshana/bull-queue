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
 * Job payloads accepted by this queue.
 *
 * Widening the Queue generic to a union lets a single queue carry different
 * job names with different data shapes (see the reference block at the
 * bottom of this file). Adding a new event type = add a member to this union.
 */
type OrderData = { task: string; order_id: number; user_id: number; amount: number };
type EmailData = { to: string; subject: string };
type ReportData = { period: 'daily' | 'weekly' };

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
const queue = new Queue<OrderData | EmailData | ReportData>(
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
export const addJobToQueue = async (data: OrderData) => {
  await queue.add('orderJob', data, {
    attempts: 3,
    delay: 1000,
    priority: 1,
    // jobId: 'order-5', // make idempotent
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
  // await queue.obliterate({ force: true }); // clean up the entire queue
  setInterval(
    () => addJobToQueue({
      task: 'job',
      order_id: Math.floor(Math.random() * 1000),
      user_id: 100,
      amount: 100,
    }),
    5000,
  );

  /**
   * Sample bulk request: enqueue several jobs in a single round-trip every
   * 5 seconds. Note the different job names — the consumer dispatches on
   * job.name, so each entry can have its own handler.
   */
  // setInterval(
  //   () =>
  //     queue.addBulk([
  //       {
  //         name: 'orderJob',
  //         data: { task: 'job', order_id: Math.floor(Math.random() * 1000), user_id: 100, amount: 100 },
  //         opts: { priority: 1 },
  //       },
  //       {
  //         name: 'emailJob',
  //         data: { to: 'user@example.com', subject: 'Order confirmed' },
  //       },
  //       {
  //         name: 'reportJob',
  //         data: { period: 'daily' },
  //         opts: { delay: 1000, priority: 2 },
  //       },
  //     ]),
  //   5000,
  // );
})();

/**
 * ---------------------------------------------------------------------------
 * More Job Options & Examples (reference)
 * ---------------------------------------------------------------------------
 *
 * The examples below show other BullMQ job options, job names, and queue
 * operations you can enable as needed. Each block is self-contained and
 * commented out so nothing runs until you uncomment it.
 *
 * The Queue generic is already widened to a union — `OrderData | EmailData |
 * ReportData` (see the type declarations near the top of this file) — so the
 * examples below type-check as written. To add another event type, extend
 * the union here and in the consumer.
 */

/**
 * 1. Job option variants on the same orderJob.
 *
 * Each example is an alternative call to queue.add('orderJob', data, opts).
 * Uncomment whichever option behavior you want to try.
 */

// Urgent: highest priority, no delay.
// await queue.add('orderJob', { task: 'job', order_id: 1, user_id: 100, amount: 100 }, {
//   priority: 1,
// });

// Delayed: wait 30s before the job becomes visible to workers.
// await queue.add('orderJob', { task: 'job', order_id: 2, user_id: 100, amount: 100 }, {
//   delay: 30000,
// });

// Retries with fixed backoff: retry up to 5 times, waiting 5s between attempts.
// await queue.add('orderJob', { task: 'job', order_id: 3, user_id: 100, amount: 100 }, {
//   attempts: 5,
//   backoff: { type: 'fixed', delay: 5000 },
// });

// Retries with exponential backoff (delay doubles each attempt).
// await queue.add('orderJob', { task: 'job', order_id: 4, user_id: 100, amount: 100 }, {
//   attempts: 5,
//   backoff: { type: 'exponential', delay: 1000 },
// });

// Idempotent jobId: a job with the same id is not added twice.
// await queue.add('orderJob', { task: 'job', order_id: 5, user_id: 100, amount: 100 }, {
//   jobId: 'order-5',
// });

// Auto-cleanup: remove the job from Redis immediately after completion/failure.
// await queue.add('orderJob', { task: 'job', order_id: 6, user_id: 100, amount: 100 }, {
//   removeOnComplete: true,
//   removeOnFail: { age: 3600, count: 100 },
// });

// LIFO: process newest jobs first (instead of FIFO).
// await queue.add('orderJob', { task: 'job', order_id: 7, user_id: 100, amount: 100 }, {
//   lifo: true,
// });

// timeout: max run duration in ms — the worker marks the job as failed if it
// does not finish within this window.
// await queue.add('orderJob', { task: 'job', order_id: 8, user_id: 100, amount: 100 }, {
//   timeout: 10000,
// });

/**
 * 2. Other job names (different payloads).
 *
 * The consumer (apps/consumer/src/index.ts) dispatches on job.name, so add a
 * matching handler there for any new name you enable.
 */

// await queue.add('emailJob', { to: 'user@example.com', subject: 'Order confirmed' });
// await queue.add('reportJob', { period: 'daily' }, { attempts: 2, delay: 1000 });

/**
 * 3. Batch publish: add several jobs in a single round-trip.
 */

// await queue.addBulk([
//   { name: 'orderJob', data: { task: 'job', order_id: 101, user_id: 100, amount: 100 } },
//   { name: 'orderJob', data: { task: 'job', order_id: 102, user_id: 100, amount: 100 }, opts: { priority: 2 } },
//   { name: 'emailJob', data: { to: 'user@example.com', subject: 'Order confirmed' } },
// ]);

/**
 * 4. Job Scheduler (v6 repeatable jobs).
 *
 * Replaces the v5 `repeat` option. Creates/updates a scheduler that produces
 * a job on a schedule. Matches the consumer's `repeatingJob` branch.
 * See CONCEPTS.md → "Upgrading from v5 to v6".
 */

// await queue.upsertJobScheduler(
//   'every-5s',
//   { every: 5000 },
//   { name: 'repeatingJob', data: { note: 'runs every 5s' } },
// );

// Cron: daily at 03:15 AM UTC.
// await queue.upsertJobScheduler('daily-report', { pattern: '0 15 3 * * *', tz: 'UTC' }, { name: 'repeatingJob' });

/**
 * 5. Queue management calls (inspect / control the queue).
 */

// const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
// console.log('Job counts:', counts);

// const jobs = await queue.getJobs(['waiting', 'active', 'delayed']);
// console.log('Jobs:', jobs);

// const failed = await queue.getFailed();
// console.log('Failed jobs:', failed);

// await queue.pause();  // stop jobs from being picked up by workers
// await queue.resume(); // NOTE: resume() is async in BullMQ v6 — must be awaited

// DANGER: obliterate removes the queue and ALL its data permanently.
// await queue.obliterate({ force: true });

// Close the Redis connection when done (e.g. during graceful shutdown).
// await queue.close();
