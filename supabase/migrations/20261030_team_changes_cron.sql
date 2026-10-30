-- Supabase Cron: evaluate due changes every minute, including when the site is closed.
-- Dates are compared in Europe/Lisbon inside the function.
begin;
create extension if not exists pg_cron;
select cron.schedule('rh-team-changes-due','* * * * *','select rh_private.process_due_team_changes()');
commit;
