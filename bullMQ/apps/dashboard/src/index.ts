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

if (!REDIS_HOST ||!REDIS_PORT ||!REDIS_PASSWORD ||!QUEUE_LIST) {
  throw new Error('Missing required environment variable');
}

const connection: ConnectionOptionType = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD
};

// get summary of jobs in the console
export const monitorQueue = async () => {
  const queue = new Queue(QUEUE_LIST[0], { connection });
  const jobCounts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  console.log('Job Counts:', jobCounts);

  const failedJobs = await queue.getFailed();
  console.log('Failed Jobs:', failedJobs);
};

const queues = ['order']
    .map(qs => new Queue(qs, { connection }))
    .map(q => new BullMQAdapter(q));

// Configure Bull-Board for BullMQ
const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues,
  serverAdapter,
});

const app = express();

serverAdapter.setBasePath('/admin/queues'); // UI will be available at /ui
app.use('/admin/queues', serverAdapter.getRouter());

// Start the Express server
app.listen(APP_PORT, () => {
  console.log(`Running on ${APP_PORT}...`);
  console.log(`For the UI, open http://localhost:${APP_PORT}/admin/queues`);
  console.log(`Make sure Redis is running on port ${REDIS_PORT} by default`);
});
