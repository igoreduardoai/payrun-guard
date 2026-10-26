import { agentTriesToPay } from '@/lib/server/engine'
export const dynamic = 'force-dynamic'
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { billId?: unknown }
  if (typeof body.billId !== 'string' || body.billId.length > 100) return Response.json({ error: 'billId required' }, { status: 400 })
  const out = await agentTriesToPay(body.billId)
  return Response.json(out, { status: out.refused ? 403 : 200 })
}
