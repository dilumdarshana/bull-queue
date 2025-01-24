declare global {
  namespace NodeJS {
    interface ProcessEnv extends EnvironmentType {}
  }
}

export {};
