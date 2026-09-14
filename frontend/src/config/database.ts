export const databaseConfig = {
  provider: 'sqlite',
  databaseUrl:
    import.meta.env.VITE_DATABASE_URL ?? 'sqlite:///./data/educational_platform.db',
  localDbPath: import.meta.env.VITE_DB_PATH ?? './data/educational_platform.db',
};

export const LOCAL_DATABASE_URL = databaseConfig.databaseUrl;
export const LOCAL_DB_PATH = databaseConfig.localDbPath;
