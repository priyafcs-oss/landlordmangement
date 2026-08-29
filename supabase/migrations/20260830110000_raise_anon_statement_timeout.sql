-- The `anon` role (this app's only role -- there's no login, see 20260818100000_drop_auth_requirement)
-- had a 3-second statement_timeout, and `authenticated` an 8-second one. Every full page load fires
-- ~22 SELECT queries concurrently (StoreProvider.refresh()) against a free-tier project, so any
-- moment of elevated latency -- a cold start after the project was idle being the common case --
-- can push a handful of those queries past 3s. The client-side selectAll() helper swallows a failed
-- query and returns [] for just that table (so the failure doesn't crash the page), which is exactly
-- what produced reports like "the property dropdown is empty" or a newly-arrived bill showing no
-- properties to assign -- state.properties (or whichever table's query lost the race) silently came
-- back empty instead of erroring visibly. Raising both roles' timeout well past a realistic cold-start
-- latency removes the actual bottleneck; store.tsx's refresh() also got a try/catch + toast in this
-- same change so any future genuine failure is surfaced instead of silently emptying a table.
ALTER ROLE anon SET statement_timeout = '20s';
ALTER ROLE authenticated SET statement_timeout = '20s';
