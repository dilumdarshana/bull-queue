/**
 * @bull/config — Shared Environment Configuration
 *
 * This package centralizes all environment variable loading for the monorepo.
 * It uses dotenv to load .env files and exports a typed ENV object.
 *
 * Every app (queue, consumer, dashboard) imports from here rather than
 * reading process.env directly, ensuring consistent config across the project.
 */

import 'dotenv/config';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralized environment configuration object.
 *
 * All values come from process.env which is populated by dotenv
 * (reading from each app's own .env file at runtime).
 *
 * Values are strings by default — consumers of this config are
 * responsible for parsing to the expected type (e.g. parseInt for ports).
 */
export const ENV = {
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  QUEUE_NAME: process.env.QUEUE_NAME,
  QUEUE_LIST: process.env.QUEUE_LIST,
  APP_PORT: process.env.APP_PORT,
};
