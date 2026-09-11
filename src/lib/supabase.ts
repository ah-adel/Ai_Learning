export const localDatabaseConfig = {
  provider: 'sqlite',
  databaseUrl: import.meta.env.VITE_DATABASE_URL ?? 'sqlite:///./data/educational_platform.db',
  localDbPath: import.meta.env.VITE_DB_PATH ?? './data/educational_platform.db',
};

export const hasSupabaseConfig = () => false;

export function getDatabaseMode(): 'local' | 'supabase' {
  return 'local';
}

export const supabase = null;
