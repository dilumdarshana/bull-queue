export interface EnvironmentType {
  REDIS_HOST: string;
  REDIS_PORT: string;
  REDIS_PASSWORD?: string;
  QUEUE_NAME: string;
}

export interface QueueOptionType {
  redis: {
    host: string;
    port: number;
    password?: string;
  }
}
