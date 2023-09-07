const Bull = require('bull');
const dotenv = require('dotenv');

dotenv.config();

const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, QUEUE_NAME } = process.env;
const queueOptions = {
  redis: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
};

// Define a queue
const orderQueue = new Bull(QUEUE_NAME, queueOptions);

// Add item to the queue
const maxLen = 1;
for (let i = 0; i < maxLen; i++) {
  orderQueue.add({
    order_id: 1000,
    user_id: 2000,
    amount: 120,
  }, {
    orderId: `Order_${i}`,
    repeat: { cron: '1/10 * * * * *' } // Scheduling jobs
  });
}
