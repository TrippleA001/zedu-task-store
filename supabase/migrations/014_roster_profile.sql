-- 014_roster_profile.sql
-- Roster rows now carry the profile details (Telegram handle, skill label)
-- collected at registration, so imported members can confirm their profile
-- on first login instead of retyping it through the onboarding wizard.
-- Both columns are nullable: the wizard remains the fallback for roster rows
-- imported without them.

alter table public.roster add column if not exists telegram_handle text;
alter table public.roster add column if not exists skill_label text;
