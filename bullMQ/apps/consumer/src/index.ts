import { Worker, Job } from 'bullmq';
import { ENV } from '@bull/config';
import { ConnectionOptionType } from '@bull/shared-types';

const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  QUEUE_NAME,
} = ENV;

if (!REDIS_HOST ||!REDIS_PORT ||!REDIS_PASSWORD ||!QUEUE_NAME) {
  throw new Error('Missing required environment variable');
}

const connection: ConnectionOptionType = {
  host: REDIS_HOST,
  port: parseInt(REDIS_PORT, 10),
  password: REDIS_PASSWORD
};

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const { order_id: orderId } = job.data;

    // Simulate job processing logic
    if (job.name === 'orderJob') {
      console.log('Order processing started:', orderId);
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Simulating job processing time
      console.log('Job proccessed', orderId);
    } else if (job.name === 'repeatingJob') {
      console.log('Repeating job executed.');
    }
  },
  { connection },
);

// Event listeners for job lifecycle
worker.on('completed', (job) => {
  console.log(`Job completed: ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`Job failed: ${job?.id}, Error: ${err.message}`);
});
