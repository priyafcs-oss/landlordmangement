type EnvRecord = Record<string, string | undefined>;

function pickFirst(env: EnvRecord, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function resolveSupabaseEnv() {
  const viteEnv = typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: EnvRecord }).env
    : undefined;
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;

  const env: EnvRecord = {
    ...(processEnv ?? {}),
    ...(viteEnv ?? {}),
  };

  return {
    url: pickFirst(env, ['VITE_SUPABASE_URL', 'SUPABASE_URL']),
    publishableKey: pickFirst(env, ['VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY']),
    serviceRoleKey: pickFirst(env, ['SUPABASE_SERVICE_ROLE_KEY']),
  };
}
