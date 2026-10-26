// Human approval tokens. Only the human-facing approval endpoint holds APPROVAL_SECRET;
// the agent never sees it, so it cannot mint its own approval.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ApprovalClaims {
  runId: string;
  billId: string;
  amountCents: number;
  currency: string;
  checkHash: string;   // binds approval to the exact pre-flight result the human saw
  approver: string;
  expiresAt: string;   // ISO
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function signApproval(claims: ApprovalClaims, secret: string): string {
  if (!secret || secret.length < 16) throw new Error("APPROVAL_SECRET must be at least 16 characters");
  const body = b64(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyApproval(token: string, secret: string, now = new Date()): ApprovalClaims {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("approval token malformed");
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("approval token signature invalid");
  const claims = JSON.parse(unb64(body)) as ApprovalClaims;
  if (Date.parse(claims.expiresAt) < now.getTime()) throw new Error("approval token expired");
  return claims;
}
