import { getRunView } from '@/lib/server/engine'
export const dynamic = 'force-dynamic'
export async function GET() { return Response.json(await getRunView()) }
