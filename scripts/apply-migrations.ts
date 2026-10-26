// Apply supabase/migrations/*.sql over HTTPS via the Supabase Management API (no DB port needed).
// Needs SUPABASE_ACCESS_TOKEN (personal access token) and SUPABASE_PROJECT_REF in the environment. Never commit them.
// Alternative: paste the SQL into the Supabase dashboard SQL editor, or `supabase db push --db-url ...`.
import { readdirSync, readFileSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) { console.error("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF"); process.exit(1); }
for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: readFileSync(`supabase/migrations/${f}`, "utf8") }),
  });
  console.log(`${f}: HTTP ${res.status}${res.ok ? "" : " " + (await res.text()).slice(0, 300)}`);
  if (!res.ok) process.exit(1);
}
