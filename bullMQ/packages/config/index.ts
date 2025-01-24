import 'dotenv/config';
import dotenv from 'dotenv';

dotenv.config();

export const ENV = {
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  QUEUE_NAME: process.env.QUEUE_NAME,
  QUEUE_LIST: process.env.QUEUE_LIST,
  APP_PORT: process.env.APP_PORT,
};
