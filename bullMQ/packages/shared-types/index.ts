/**
 * @bull/shared-types — Shared TypeScript Interfaces
 *
 * This package provides shared type definitions used across multiple
 * apps in the monorepo. Keeping types here avoids duplication and
 * ensures consistency between producers (queue) and consumers (worker).
 */

/**
 * Type definition for environment variables used by the queue and consumer apps.
 *
 * All values originate as strings from environment variables. The consumer
 * app is responsible for parsing numeric values (e.g. REDIS_PORT) as needed.
 */
export interface EnvironmentType {
  REDIS_HOST: string;
  REDIS_PORT: string;
  REDIS_PASSWORD?: string;
  QUEUE_NAME: string;
}

/**
 * Redis connection options compatible with BullMQ's connection interface.
 *
 * Used when creating Queue, Worker, and QueueEvents instances.
 *
 * @property host - Redis server hostname (e.g. "127.0.0.1")
 * @property port - Redis server port (number, parsed from env)
 * @property password - Optional Redis AUTH password
 */
export interface ConnectionOptionType {
  host: string;
  port: number;
  password?: string;
}
