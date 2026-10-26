import { MemoryStore } from "./MemoryStore.ts";
import { SupabaseStore } from "./SupabaseStore.ts";
import type { Store } from "./Store.ts";

const supabaseKey = (env: NodeJS.ProcessEnv) => env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Default: Supabase when SUPABASE_URL + a server secret key are present; otherwise the offline MemoryStore.
 * STORE=memory forces offline (Hack Fair fallback). STORE=supabase without config falls back to memory with a note.
 */
export function storeFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): { store: Store; note: string } {
  if (env.STORE === "memory") return { store: new MemoryStore(), note: "memory (STORE=memory)" };
  const key = supabaseKey(env);
  if (env.SUPABASE_URL && key && !key.startsWith("sb_publishable_")) {
    return { store: new SupabaseStore({ url: env.SUPABASE_URL, secretKey: key, fetchImpl }), note: "supabase" };
  }
  return { store: new MemoryStore(), note: env.STORE === "supabase" ? "memory (STORE=supabase requested but SUPABASE_URL/SUPABASE_SECRET_KEY missing)" : "memory (offline: no Supabase config)" };
}

/** Like storeFromEnv, but probes Supabase once and falls back to memory if it is unreachable or rejects the key. */
export async function storeFromEnvWithFallback(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): Promise<{ store: Store; note: string }> {
  const picked = storeFromEnv(env, fetchImpl);
  if (picked.store.kind !== "supabase") return picked;
  try {
    await picked.store.listPayments("__probe__");
    return picked;
  } catch (e) {
    return { store: new MemoryStore(), note: `memory (Supabase unavailable: ${(e as Error).message.slice(0, 80)})` };
  }
}
export { MemoryStore, SupabaseStore };
export type { Store };
