/**
 * Consumer (Worker) — BullMQ Job Processor
 *
 * This is the worker service that picks up jobs from the BullMQ queue
 * (added by the Queue producer) and processes them.
 *
 * Key BullMQ concepts demonstrated here:
 * - Worker: The class that consumes and processes jobs
 * - Processor function: The async callback that does the actual work
 * - Job lifecycle events: completed, failed
 * - Concurrent processing: Multiple jobs can be processed in parallel
 *   (controlled by the concurrency option, default: 1)
 *
 * Architecture note:
 *   The Worker uses a blocking Redis connection (BRPOPLPUSH-style) to
 *   wait for new jobs without polling. This means zero CPU usage when
 *   the queue is empty.
 */

import { Worker, Job } from 'bullmq';
import { ENV } from '@bull/config';
import { ConnectionOptionType } from '@bull/shared-types';

const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  QUEUE_NAME,
} = ENV;

/**
 * Validate required environment variables before attempting to connect.
 * Fails fast with a clear message rather than obscure Redis errors.
 */
if (!REDIS_HOST || !REDIS_PORT || !REDIS_PASSWORD || !QUEUE_NAME) {
  throw new Error('Missing required environment variable');
}

const connection: ConnectionOptionType = {
  host: REDIS_HOST,
  port: parseInt(REDIS_PORT, 10),
  password: REDIS_PASSWORD
};

/**
 * Create a BullMQ Worker instance.
 *
 * The Worker connects to the queue and starts processing jobs immediately
 * (unless autorun: false is set). It uses a blocking Redis connection
 * internally (via duplicate client) to wait for jobs without polling.
 *
 * @param QUEUE_NAME    - The name of the queue to consume from
 * @param processor     - Async function that processes each job
 * @param options       - Worker options:
 *   - connection: Redis connection config
 *   - concurrency: Number of jobs to process in parallel (default: 1)
 *   - autorun: Start processing immediately (default: true)
 *   - limiter: Rate limiting config (max jobs per duration)
 *
 * Processor function receives:
 *   @param job     - The Job instance with data, progress, and control methods
 *   @param token   - Unique token string for this job's lock
 *   @param signal  - AbortSignal for detecting cancellation
 *
 * The return value of the processor becomes job.returnvalue and is
 * available on the completed event or via job.getChildrenValues().
 *
 * Stalled job handling:
 *   If a worker crashes while processing a job, BullMQ detects it after
 *   stallInterval (default 30s) and re-queues the job for another worker.
 *   This ensures jobs are never lost due to worker crashes.
 */
const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const { order_id: orderId } = job.data;

    /**
     * Process jobs based on their name.
     *
     * BullMQ supports named jobs within a single queue. This allows
     * a single worker to handle different types of work by checking
     * the job name, rather than needing separate queues.
     */
    if (job.name === 'orderJob') {
      console.log('Order processing started:', orderId);

      /**
       * Simulate async processing time (e.g. payment, inventory, email).
       * In production, this would be real async operations like:
       *   - await processPayment(orderId)
       *   - await updateInventory(orderId)
       *   - await sendConfirmation(orderId)
       *
       * The job's progress can be reported via:
       *   await job.updateProgress(50);  // 50% complete
       *   await job.updateProgress({ step: 'payment' });
       */
      await new Promise((resolve) => setTimeout(resolve, 3000));

      console.log('Job processed', orderId);

      /**
       * The return value of the processor is stored as job.returnvalue.
       * It's accessible to:
       *   - Parent jobs via job.getChildrenValues() (in FlowProducer trees)
       *   - QueueEvents listeners via the 'completed' event
       */
      return { status: 'completed', orderId };
    } else if (job.name === 'repeatingJob') {
      console.log('Repeating job executed.');
    }
  },
  {
    connection,
    concurrency: 2,
  },

  /**
   * Additional worker options (commented for reference):
   *
   *   concurrency: 5,
   *     Process up to 5 jobs simultaneously. Useful for I/O-bound work.
   *     Keep this low for CPU-heavy work to avoid blocking the event loop.
   *
   *   limiter: { max: 10, duration: 1000 },
   *     Global rate limit: max 10 jobs per second across ALL workers.
   *
   *   autorun: false,
   *     Don't start processing immediately. Call worker.run() manually.
   *
   *   stalledInterval: 30000,
   *     How often to check for stalled jobs (default: 30s).
   *
   *   lockDuration: 30000,
   *     How long a worker holds the lock on a job (default: 30s).
   *     Jobs taking longer auto-extend their lock.
   */
);

/**
 * Listen for job completion events.
 *
 * This event fires when the processor function returns successfully.
 * The return value from the processor is passed as the second argument.
 *
 * For global event monitoring across all workers, use QueueEvents instead.
 */
worker.on('completed', (job) => {
  console.log(`Job completed: ${job.id}`);
});

/**
 * Listen for job failure events.
 *
 * This event fires when the processor function throws an error.
 * If the job has remaining attempts, it will be retried automatically.
 * After exhausting all attempts, it moves to the 'failed' set permanently.
 *
 * Always attach an error handler to avoid Node.js unhandled exception
 * warnings, which can crash the worker process.
 */
worker.on('failed', (job, err) => {
  console.error(`Job failed: ${job?.id}, Error: ${err.message}`);
});

/**
 * Additional useful worker events (commented for reference):
 *
 * worker.on('active', (job) => {
 *   console.log(`Job started: ${job.id}`);
 * });
 *
 * worker.on('progress', (job, progress) => {
 *   console.log(`Job ${job.id} progress: ${progress}`);
 * });
 *
 * worker.on('drained', () => {
 *   console.log('Queue is empty — no more jobs to process');
 * });
 *
 * worker.on('error', (err) => {
 *   console.error('Redis connection error:', err);
 *   // CRITICAL: Without this handler, the worker may stop processing
 *   // on Redis connection errors (Node.js EventEmitter behavior)
 * });
 *
 * worker.on('paused', () => {
 *   console.log('Worker paused');
 * });
 *
 * worker.on('resumed', () => {
 *   console.log('Worker resumed');
 * });
 *
 * Graceful shutdown (e.g. on SIGTERM):
 *   process.on('SIGTERM', async () => {
 *     await worker.close();  // Wait for active jobs to finish
 *     process.exit(0);
 *   });
 */

/**
 * ---------------------------------------------------------------------------
 * More Consumer Examples (reference)
 * ---------------------------------------------------------------------------
 *
 * Mirror of the reference block in apps/queue/src/index.ts. Each block is
 * self-contained and commented out so nothing runs until you uncomment it.
 * Any job name you publish from the queue side must have a matching handler
 * here (see queue-side block 2 for the other job names).
 */

/**
 * 1. Extensible handler map (replaces the if/else chain above).
 *
 * Dispatch on job.name via a Record so adding a new event type only means
 * adding one entry — no growing if/else ladder.
 */

// import { Worker, Job, UnrecoverableError } from 'bullmq';
//
// const handlers: Record<string, (job: Job) => Promise<unknown>> = {
//   orderJob: async (job) => {
//     const { order_id } = job.data as { order_id: number };
//     console.log('Order processing started:', order_id);
//     await new Promise((resolve) => setTimeout(resolve, 3000));
//     console.log('Job processed', order_id);
//   },
//   emailJob: async (job) => {
//     const { to, subject } = job.data as { to: string; subject: string };
//     console.log(`Sending "${subject}" to ${to}...`);
//     await new Promise((resolve) => setTimeout(resolve, 1000));
//     console.log('Email sent');
//   },
//   reportJob: async (job) => {
//     const { period } = job.data as { period: 'daily' | 'weekly' };
//     console.log(`Generating ${period} report...`);
//     await new Promise((resolve) => setTimeout(resolve, 2000));
//     console.log('Report ready');
//   },
//   repeatingJob: async (job) => {
//     console.log('Repeating job executed.');
//   },
// };
//
// const processor = async (job: Job) => {
//   const handler = handlers[job.name];
//   if (!handler) {
//     console.warn(`No handler for job type "${job.name}"`);
//     return;
//   }
//   await handler(job);
// };
//
// const worker = new Worker(QUEUE_NAME, processor, { connection });

/**
 * 2. Job methods available inside the processor.
 *
 * The processor signature is (job, token, signal):
 *   - token:  unique lock token for this job (needed by moveToFailed)
 *   - signal: AbortSignal that fires if the job is cancelled while processing
 */

// await job.updateProgress(50);                          // report progress (Bull Board + 'progress' event)
// await job.updateData({ ...job.data, note: 'updated' }); // replace the job payload in place
// await job.log('processing step 1');                    // append a line to the job's log
// const state = await job.getState();                    // e.g. 'active' | 'delayed' | 'completed' | 'failed'
// const attempts = job.attemptsMade;                     // attempts so far (0 on first run)
// return { status: 'completed', orderId };               // return value → job.returnvalue

/**
 * 3. Failing / retrying on purpose.
 */

// throw new Error('simulated failure');        // auto-retry (respects opts.attempts + backoff)
// throw new UnrecoverableError('do not retry'); // fail permanently — no automatic retry

// Manually move to failed (inside a processor, using the token param):
// const processorWithToken = async (job: Job, token: string) => {
//   await job.moveToFailed(new Error('manual failure'), token);
// };

/**
 * 4. Worker options (alternate constructor).
 */

// const worker = new Worker(QUEUE_NAME, processor, {
//   connection,
//   concurrency: 5,                        // process up to 5 jobs in parallel
//   limiter: { max: 10, duration: 1000 },  // at most 10 jobs/sec across all workers
//   autorun: false,                        // don't start automatically (call worker.run())
//   stalledInterval: 30000,                // how often to check for stalled jobs
//   lockDuration: 30000,                   // lock held while processing; auto-renewed
//   maxStalledCount: 1,                    // times a job may be flagged as stalled
// });

/**
 * 5. Worker control at runtime.
 */

// await worker.run();          // start processing (required when autorun: false)
// await worker.pause();        // stop picking up new jobs (active ones finish)
// await worker.resume();       // NOTE: async in BullMQ v6 — must be awaited
// worker.concurrency = 10;     // change concurrency at runtime
// await worker.close();        // stop processing and close Redis connections

/**
 * 6. QueueEvents — global, queue-wide monitoring across ALL workers.
 *    (Unlike worker.on(...), these see events from every producer/worker.)
 */

// import { QueueEvents } from 'bullmq';
//
// const events = new QueueEvents(QUEUE_NAME, { connection });
// events.on('waiting', ({ jobId }) => console.log(`Global: job ${jobId} waiting`));
// events.on('active', ({ jobId }) => console.log(`Global: job ${jobId} active`));
// events.on('completed', ({ jobId, returnvalue }) => console.log(`Global: job ${jobId} completed`, returnvalue));
// events.on('failed', ({ jobId, failedReason }) => console.error(`Global: job ${jobId} failed: ${failedReason}`));
// await events.close();
