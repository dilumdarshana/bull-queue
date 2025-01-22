import Queue from 'bull';
import dotenv from 'dotenv';
import { promisify } from 'util';
import { EnvironmentType, QueueOptionType } from './types/common.js';

dotenv.config();
const sleep = promisify(setTimeout);

const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  QUEUE_NAME,
} = process.env as unknown as EnvironmentType;

if (!REDIS_HOST ||!REDIS_PORT ||!REDIS_PASSWORD ||!QUEUE_NAME) {
  throw new Error('Missing required environment variable');
}

// Queue option
const queueOptions: QueueOptionType = {
  redis: {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT || '', 10),
    password: REDIS_PASSWORD,
  },
}

// Define a queue
try {
  const orderQueue = new Queue<{ order_id: string }>(QUEUE_NAME, queueOptions);

  orderQueue.process(async (job, done: (error?: Error) => void) => {
    try {
      const { order_id: orderId } = job.data;
      job.progress(30);
      console.log(`Order Initialized, ${orderId}`);
      await sleep(5000);

      job.log(`Payment Completed: ${orderId}`);
      job.progress(60);
      console.log('Payment Completed', orderId);
      await sleep(5000);

      job.log(`Order Placed, ${orderId}`);
      job.progress(100);
      console.log('Order Placed', orderId);

      done();
    } catch (error) {
      done(error as Error);
    }
  });

  // Get order statuses
  orderQueue.on('completed', (order) => {
    console.log(`Order completed. Job id: ${order.id}`);
  });

  orderQueue.on('failed', (order) => {
    console.log(`Order failed. Job id: ${order.id}`);
  });
} catch (error) {
  console.error('Failed to create queue', error);
}
