import { approveSafeBills } from '@/lib/server/engine'
export const dynamic = 'force-dynamic'
// Demo approval: in this public demo the button stands in for a signed-in finance approver.
export async function POST() {
  try { return Response.json(await approveSafeBills()) }
  catch (e) { return Response.json({ ok: false, payments: [], audit: [], error: (e as Error).message }, { status: 500 }) }
}
