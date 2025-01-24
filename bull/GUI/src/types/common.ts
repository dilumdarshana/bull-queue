export interface EnvironmentType {
  REDIS_HOST: string;
  REDIS_PORT: string;
  REDIS_PASSWORD?: string;
  APP_PORT: string,
  QUEUE_LIST: string,
}

export interface QueueOptionType {
  redis: {
    host: string;
    port: number;
    password?: string;
  }
}
