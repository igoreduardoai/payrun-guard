-- READ-ONLY. Paste into the Supabase SQL editor to confirm what the Data API cannot show.
-- 1) RLS flag per table (expect true x5)
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relname like 'payrun\_%' and relkind = 'r' order by relname;
-- 2) Policies (expect 5 SELECT policies for authenticated, none for anon)
select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' and tablename like 'payrun\_%' order by tablename;
-- 3) Triggers (expect append-only triggers on audit_log and payments; + truncate guards after the hardening migration)
select event_object_table, trigger_name, event_manipulation, action_timing from information_schema.triggers
where trigger_schema = 'public' and event_object_table like 'payrun\_%' order by 1, 2, 3;
-- 4) Table privileges per role
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'payrun\_%' and grantee in ('anon', 'authenticated', 'service_role')
group by 1, 2 order by 1, 2;
-- 5) Unique / check / FK constraints
select conrelid::regclass as tbl, conname, contype, pg_get_constraintdef(oid) from pg_constraint
where connamespace = 'public'::regnamespace and conrelid::regclass::text like 'payrun\_%' order by 1, 2;
