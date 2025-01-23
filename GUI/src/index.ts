import express from 'express';
import dotenv from 'dotenv';
import Queue from 'bull';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { EnvironmentType, QueueOptionType } from './types/common';

dotenv.config();

const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  APP_PORT,
  QUEUE_LIST,
} = process.env as unknown as EnvironmentType;
const redisOptions: QueueOptionType = {
  redis: {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT, 10),
    password: REDIS_PASSWORD,
  },
};

// validate env variables
if (!REDIS_HOST || !REDIS_PORT || !REDIS_PASSWORD || !APP_PORT || !QUEUE_LIST.length) {
  throw new Error('Missing required environment variable');
}

// queue list a json
const queueList: string[] = JSON.parse(QUEUE_LIST);

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
  console.log(`For the UI, open http://localhost:${APP_PORT}/admin/queues`);
  console.log(`Make sure Redis is running on port ${REDIS_PORT} by default`);
});
