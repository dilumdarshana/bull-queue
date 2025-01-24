import { Queue } from 'bullmq';
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
  port: REDIS_PORT,
  password: REDIS_PASSWORD
};

// Define a queue
const queue = new Queue<{ task: string; order_id: number; user_id: number; amount: number }>(
  QUEUE_NAME,
  { connection },
);

// Add a job to the queue
export const addJobToQueue = async (data: { task: string; order_id: number; user_id: number; amount: number }) => {
  await queue.add('orderJob', data, {
    attempts: 3, // Retry up to 3 times if the job fails
    delay: 1000, // Optional delay in milliseconds
    priority: 1, // Optional job priority
  });
};

(async () => {
  await addJobToQueue({ task: 'job', order_id: 1, user_id: 100, amount: 100 });
})();
