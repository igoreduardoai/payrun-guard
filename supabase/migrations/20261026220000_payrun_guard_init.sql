-- PayRun Guard schema. Row-level security is ON for every table.
-- The public (anon / publishable) key gets NO access. The server writes with the secret key
-- (service role bypasses RLS). Signed-in approvers can read only their own org's rows.
-- Approval tokens are stored as SHA-256 hashes, never raw. The audit log is append-only.

-- Tables live in public with a payrun_ prefix so the Supabase Data API serves them without extra config.

create table public.payrun_runs (
  id                text primary key,                  -- run_<asOf>_<snapshotHash12>
  org_id            uuid not null default '00000000-0000-0000-0000-000000000000',
  as_of             date not null,
  window_end        date not null,
  source_account_id text not null,
  snapshot_hash     text not null,
  cash              jsonb not null,                    -- startCents, committedOutflowsCents, payCents, endCents, floorCents, expectedInflowsCents
  run_findings      jsonb not null default '[]',
  data_source       text not null check (data_source in ('rho_sandbox', 'fixtures', 'rho_production')),
  created_at        timestamptz not null default now()
);

create table public.payrun_bill_checks (
  run_id         text not null references public.payrun_runs(id) on delete restrict,
  bill_id        text not null,
  invoice_number text,
  vendor_id      text,
  amount_cents   bigint check (amount_cents is null or amount_cents >= 0),
  currency       text,
  pass           boolean not null,
  decision       text not null check (decision in ('pay', 'hold')),
  hold_reasons   text[] not null default '{}',
  findings       jsonb not null default '[]',
  check_hash     text not null,
  due_date       date,
  created_at     timestamptz not null default now(),
  primary key (run_id, bill_id),
  constraint pay_requires_pass check (decision = 'hold' or pass)
);

create table public.payrun_approvals (
  id           bigint generated always as identity primary key,
  run_id       text not null,
  bill_id      text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency     text not null,
  check_hash   text not null,
  approver     text not null,
  token_sha256 text not null unique,                   -- hash only; the raw token never touches the DB
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  foreign key (run_id, bill_id) references public.payrun_bill_checks(run_id, bill_id) on delete restrict
);

create table public.payrun_payments (
  payment_id        text primary key,
  idempotency_key   text not null unique,              -- double click => same row
  run_id            text not null,
  bill_id           text not null,
  counterparty_id   text not null,
  payment_method_id text not null,
  source_account_id text not null,
  amount_cents      bigint not null check (amount_cents > 0),
  currency          text not null,
  status            text not null,
  simulated         boolean not null,
  rail              text not null,
  created_at        timestamptz not null default now(),
  unique (run_id, bill_id),                            -- one payment per bill per run, whatever the key
  foreign key (run_id, bill_id) references public.payrun_bill_checks(run_id, bill_id) on delete restrict
);

create table public.payrun_audit_log (
  id         bigint generated always as identity primary key,
  run_id     text,
  bill_id    text,
  actor      text not null,                            -- 'agent' | 'human:<name>' | 'system'
  event      text not null,                            -- run_planned | approval_signed | payment_created | payment_duplicate | gate_refused
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Append-only audit log and immutable payments: block UPDATE/DELETE for everyone.
create or replace function public.payrun_forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger audit_log_append_only before update or delete on public.payrun_audit_log for each row execute function public.payrun_forbid_change();
create trigger payments_immutable   before update or delete on public.payrun_payments  for each row execute function public.payrun_forbid_change();

-- RLS on everything
alter table public.payrun_runs        enable row level security;
alter table public.payrun_bill_checks enable row level security;
alter table public.payrun_approvals   enable row level security;
alter table public.payrun_payments    enable row level security;
alter table public.payrun_audit_log   enable row level security;

-- No grants to anon at all. Authenticated users may only SELECT rows of their org (org_id in JWT app_metadata).
revoke all on public.payrun_runs, public.payrun_bill_checks, public.payrun_approvals, public.payrun_payments, public.payrun_audit_log from anon, authenticated;
grant select on public.payrun_runs, public.payrun_bill_checks, public.payrun_approvals, public.payrun_payments, public.payrun_audit_log to authenticated;
grant select, insert on public.payrun_runs, public.payrun_bill_checks, public.payrun_approvals, public.payrun_payments, public.payrun_audit_log to service_role;
grant update on public.payrun_runs, public.payrun_bill_checks to service_role;
revoke execute on function public.payrun_forbid_change() from public, anon, authenticated;

create policy payrun_runs_read on public.payrun_runs for select to authenticated
  using (org_id::text = coalesce(auth.jwt() -> 'app_metadata' ->> 'org_id', ''));
create policy payrun_checks_read on public.payrun_bill_checks for select to authenticated
  using (exists (select 1 from public.payrun_runs r where r.id = run_id and r.org_id::text = coalesce(auth.jwt() -> 'app_metadata' ->> 'org_id', '')));
create policy payrun_approvals_read on public.payrun_approvals for select to authenticated
  using (exists (select 1 from public.payrun_runs r where r.id = run_id and r.org_id::text = coalesce(auth.jwt() -> 'app_metadata' ->> 'org_id', '')));
create policy payrun_payments_read on public.payrun_payments for select to authenticated
  using (exists (select 1 from public.payrun_runs r where r.id = run_id and r.org_id::text = coalesce(auth.jwt() -> 'app_metadata' ->> 'org_id', '')));
create policy payrun_audit_read on public.payrun_audit_log for select to authenticated
  using (exists (select 1 from public.payrun_runs r where r.id = run_id and r.org_id::text = coalesce(auth.jwt() -> 'app_metadata' ->> 'org_id', '')));

create index on public.payrun_bill_checks (run_id, decision);
create index on public.payrun_audit_log (run_id, created_at);
