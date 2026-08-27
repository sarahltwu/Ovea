-- ============================================================
--  Ovea, feedback + problem reports
--  ------------------------------------------------------------
--  Paste into: Supabase Dashboard → SQL Editor → Run.
--
--  Anyone (signed in or not) can SEND feedback, but nobody can read
--  it back through the API except a moderator. That keeps other
--  people's reports private while still letting girls report a
--  problem without having to make an account first.
--
--  To read what comes in:
--    Supabase Dashboard → Table editor → feedback
--    (or: select * from public.feedback order by created_at desc;)
-- ============================================================

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  kind       text not null default 'other',   -- topic | feature | improvement | praise | other
  message    text not null,
  email      text,                            -- optional, only if they want a reply
  user_id    uuid references auth.users on delete set null,
  page       text,                            -- which page they sent it from
  created_at timestamptz default now()
);

alter table public.feedback enable row level security;

-- Anyone may submit, including anonymous visitors.
drop policy if exists "feedback insert anyone" on public.feedback;
create policy "feedback insert anyone" on public.feedback
  for insert with check ( true );

-- Only moderators may read submissions back.
drop policy if exists "feedback read admin" on public.feedback;
create policy "feedback read admin" on public.feedback
  for select using ( public.is_admin() );

-- Keep one person from flooding the table: cap message length.
alter table public.feedback drop constraint if exists feedback_message_len;
alter table public.feedback add constraint feedback_message_len
  check ( char_length(message) between 1 and 1500 );
