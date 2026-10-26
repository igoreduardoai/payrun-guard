import { MemoryStore } from "./MemoryStore.ts";
import { SupabaseStore } from "./SupabaseStore.ts";
import type { Store } from "./Store.ts";

/** STORE=supabase uses SUPABASE_URL + SUPABASE_SECRET_KEY; anything else (or missing config) uses the offline MemoryStore. */
export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): { store: Store; note: string } {
  if (env.STORE === "supabase") {
    const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (env.SUPABASE_URL && key && !key.startsWith("sb_publishable_")) {
      return { store: new SupabaseStore({ url: env.SUPABASE_URL, secretKey: key }), note: "supabase" };
    }
    return { store: new MemoryStore(), note: "memory (STORE=supabase requested but SUPABASE_URL/SUPABASE_SECRET_KEY missing)" };
  }
  return { store: new MemoryStore(), note: "memory (offline)" };
}
export { MemoryStore, SupabaseStore };
export type { Store };
