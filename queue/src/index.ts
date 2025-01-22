import Queue from 'bull';
import dotenv from 'dotenv';
import { EnvironmentType, QueueOptionType } from './types/common.js';

dotenv.config();

const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  QUEUE_NAME,
} = process.env as unknown as EnvironmentType;

// Define queue options (Redis connection details)
const queueOptions: QueueOptionType = {
  redis: {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT || '', 10),
    password: REDIS_PASSWORD,
  },
};

if (!REDIS_HOST || !REDIS_PORT || !REDIS_PASSWORD || !QUEUE_NAME) {
  throw new Error('Missing required environment variable');
}

// Define a queue
const orderQueue = new Queue<{ task: string; order_id: number; user_id: number; amount: number}>(
  QUEUE_NAME,
  queueOptions,
);

// Add item to the queue
const jobs = [1, 2];
jobs.forEach(async (job) => {
  await orderQueue.add({
    task: 'job',
    order_id: job,
    user_id: 2000,
    amount: 120,
  // }, {
  //   jobId: `Order_${job}`,
  //   repeat: { cron: '*/10 * * * * *' } // Scheduling job every 10 seconds
  // });
  });
});
