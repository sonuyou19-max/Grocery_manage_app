-- ---------------------------------------------------------------------------
-- The weekly recap is AI-written prose, so it is language-specific. The shared
-- household row holds one text; record which language it was written in so a
-- member reading the app in another language regenerates it instead of being
-- shown a recap they can't read.
--
-- Existing rows predate localization and are all English.
-- ---------------------------------------------------------------------------

alter table household_recaps
  add column language text not null default 'en';
