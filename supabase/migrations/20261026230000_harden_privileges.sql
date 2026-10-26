-- PROPOSED (not applied yet). Found by scripts/verify-live.ts on 2026-10-26:
-- UPDATE/DELETE on payrun_audit_log and payrun_payments with the secret key reached the append-only
-- trigger (P0001) instead of failing on privileges. So service_role holds more privileges than the
-- init migration granted (Supabase's default privileges on public give it ALL, incl. TRUNCATE).
-- Row triggers do not fire on TRUNCATE, so the audit log could still be emptied with TRUNCATE.
-- Minimal fix: drop the extra privileges and add a statement-level TRUNCATE guard.

revoke update, delete, truncate on public.payrun_approvals, public.payrun_payments, public.payrun_audit_log from service_role;
revoke delete, truncate on public.payrun_runs, public.payrun_bill_checks from service_role;
revoke truncate on public.payrun_runs, public.payrun_bill_checks, public.payrun_approvals, public.payrun_payments, public.payrun_audit_log from anon, authenticated;

drop trigger if exists audit_log_no_truncate on public.payrun_audit_log;
create trigger audit_log_no_truncate before truncate on public.payrun_audit_log for each statement execute function public.payrun_forbid_change();
drop trigger if exists payments_no_truncate on public.payrun_payments;
create trigger payments_no_truncate before truncate on public.payrun_payments for each statement execute function public.payrun_forbid_change();
