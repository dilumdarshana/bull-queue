import Bull from 'bull';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();
const sleep = promisify(setTimeout);

const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, QUEUE_NAME } = process.env;
const queueOptions = {
  redis: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
};

// Define a queue
try {
  const orderQueue = new Bull(QUEUE_NAME, queueOptions);

  // Register process
  orderQueue.process(async (payload, done) => {
    const { order_id: orderId } = payload.data;
    payload.progress(30);
    console.log('Order Initialized', orderId);
    await sleep(5000);

    payload.log('Payment Completed', orderId);
    payload.progress(60);
    console.log('Payment Completed', orderId);
    await sleep(5000);

    payload.log('Order Placed', orderId);
    payload.progress(100);
    console.log('Order Placed', orderId);

    done();
  });

  // Get order statuses
  orderQueue.on('completed', (order) => {
    console.log(`Order ${order.id} completed`);
  });

  orderQueue.on('failed', (order) => {
    console.log(`Order ${order.id} failed`);
  });
} catch (err) {
  console.log('Error', err);
}
