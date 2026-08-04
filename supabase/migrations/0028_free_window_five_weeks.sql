-- ---------------------------------------------------------------------------
-- The free window becomes five weeks — and this migration turns Plus ON.
--
-- ###########################################################################
-- #  DO NOT APPLY THIS UNTIL PLAY CONSOLE AND REVENUECAT ARE LIVE.          #
-- #                                                                         #
-- #  Every other migration in this ledger is safe to run whenever. This one #
-- #  is not, and the reason is structural rather than a matter of taste:    #
-- #  `plus_gate_active` is derived as free_history_weeks() <                #
-- #  paid_history_weeks() (migration 0025), so narrowing the free window is #
-- #  the same act as switching the paid tier on. There is no ordering in    #
-- #  which this is "just a number".                                         #
-- #                                                                         #
-- #  Applied before there is anything to sell, it locks the paid features   #
-- #  for every account past its free month and sends them to a paywall that #
-- #  cannot take money. The paywall handles that state honestly — it says   #
-- #  so and offers a retry — but "we are selling you something you cannot   #
-- #  buy" is not a state to be in by accident.                              #
-- #                                                                         #
-- #  To undo: set the interval back to 520 weeks. It takes effect for every #
-- #  client on their next entitlement fetch, with no app release.           #
-- ###########################################################################
--
-- ---------------------------------------------------------------------------
-- Why five and not four
-- ---------------------------------------------------------------------------
--
-- Four weeks was the number 0025 was written against, and it is two days short
-- of the one the app actually needs.
--
-- The Insights cards offer rolling windows — 7 days, 30 days, 3 months, 12
-- months — and 30 days is the default view. Which of those a free account may
-- select is derived from this function rather than from a list in the client
-- (see `beyondFreeWindow` in components/range-picker.tsx), precisely so the two
-- cannot disagree. At four weeks the derivation is correct and the consequence
-- is absurd: 28 < 30, so a free user's DEFAULT card sits behind the paywall.
--
-- The alternatives were to special-case the default past the gate — which makes
-- the gate mean two different things depending on which control you touched —
-- or to move the default to 7 days, which throws away most of what the card is
-- for. Widening the free tier by seven days costs the least and is the only one
-- of the three a user could describe accurately.
--
-- Five weeks also keeps the free tier a clean statement: "the last month or so
-- of your shopping", against a paid year. Nobody has to explain 28.
-- ---------------------------------------------------------------------------

create or replace function free_history_weeks()
returns interval
language sql
immutable
as $$ select interval '5 weeks' $$;

-- Deliberately not re-granting: 0025 granted execute to authenticated, anon and
-- service_role, and `create or replace` keeps a function's existing privileges.
-- Restating them here would suggest they had been dropped, which is the kind of
-- false signal that gets copied into the next migration.

-- ---------------------------------------------------------------------------
-- Check it landed, and see what it did:
--
--   select free_history_weeks(), paid_history_weeks();
--   -- expect 35 days, 364 days
--
--   select plus_gate_active from my_entitlement();
--   -- expect true — that is the tier being on, not a fault
-- ---------------------------------------------------------------------------
