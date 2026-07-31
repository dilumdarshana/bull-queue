/**
 * Dashboard — BullMQ Monitoring UI with Bull Board
 *
 * This app provides a web interface to inspect queues, view job details,
 * retry failed jobs, and monitor queue performance in real-time.
 *
 * Bull Board is the community dashboard for BullMQ that connects to
 * your Redis-backed queues and visualizes their state.
 *
 * BullMQ concepts demonstrated here:
 * - Queue: Fetching job counts and failed jobs programmatically
 * - BullMQAdapter: Connects Bull Board to BullMQ queues
 * - QueueEvents (via Bull Board): Real-time updates on job state changes
 */

import { Queue } from 'bullmq';
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { ENV } from '@bull/config';
import { ConnectionOptionType } from '@bull/shared-types';

const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  QUEUE_LIST,
  APP_PORT = 3000,
} = ENV;

/**
 * Validate required environment variables.
 * QUEUE_LIST is a JSON array like '["order"]' specifying which queues
 * to monitor in the dashboard.
 */
if (!REDIS_HOST ||!REDIS_PORT ||!REDIS_PASSWORD ||!QUEUE_LIST) {
  throw new Error('Missing required environment variable');
}

const connection: ConnectionOptionType = {
  host: REDIS_HOST,
  port: parseInt(REDIS_PORT, 10),
  password: REDIS_PASSWORD
};

/**
 * Fetch and log a summary of all jobs in the first queue.
 *
 * This is a utility function that demonstrates programmatic queue
 * inspection — getting counts per state and listing failed jobs.
 * This could be used for health checks or alerting.
 */
export const monitorQueue = async () => {
  const queue = new Queue(QUEUE_LIST[0], { connection });
  const jobCounts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  console.log('Job Counts:', jobCounts);

  const failedJobs = await queue.getFailed();
  console.log('Failed Jobs:', failedJobs);
};

/**
 * Configure Bull Board to monitor our queues.
 *
 * Bull Board supports multiple queue backends (Bull, BullMQ).
 * The BullMQAdapter wraps each BullMQ Queue instance so Bull Board
 * can interact with it (pause, resume, retry jobs, etc.).
 */
const queues = ['order']
    .map(qs => new Queue(qs, { connection }))
    .map(q => new BullMQAdapter(q));

/**
 * Create the Express adapter and mount Bull Board.
 *
 * ExpressAdapter integrates Bull Board into an Express app.
 * setBasePath configures the URL path for the dashboard UI.
 */
const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues,
  serverAdapter,
});

const app = express();

serverAdapter.setBasePath('/admin/queues');
app.use('/admin/queues', serverAdapter.getRouter());

/**
 * Start the Express server.
 *
 * The Bull Board UI is now available at:
 *   http://localhost:3000/admin/queues
 *
 * From the dashboard you can:
 *   - View all queues and their job counts
 *   - Inspect individual job details (data, progress, stacktraces)
 *   - Retry failed jobs
 *   - Pause/resume queues
 *   - View real-time job events
 */
app.listen(APP_PORT, () => {
  console.log(`Running on ${APP_PORT}...`);
  console.log(`For the UI, open http://localhost:${APP_PORT}/admin/queues`);
  console.log(`Make sure Redis is running on port ${REDIS_PORT} by default`);
});
