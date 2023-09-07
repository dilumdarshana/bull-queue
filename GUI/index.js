const express = require('express');
const dotenv = require('dotenv');
const Queue = require('bull');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

(() => {
  dotenv.config();

  const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, APP_PORT, QUEUE_LIST } = process.env;
  const redisOptions = {
    redis: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
  };

  const queueList = JSON.parse(QUEUE_LIST);

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const queues = queueList
    .map(qs => new Queue(qs, redisOptions))
    .map(q => new BullAdapter(q));

  const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
    queues,
    serverAdapter: serverAdapter,
  });

  const app = express();

  // Router
  app.use('/admin/queues', serverAdapter.getRouter());

  app.listen(APP_PORT, () => {
    console.log(`Running on ${APP_PORT}...`);
    console.log('For the UI, open http://localhost:3000/admin/queues');
    console.log('Make sure Redis is running on port 6379 by default');
  });
})();
