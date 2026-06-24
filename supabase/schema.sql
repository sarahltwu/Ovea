-- ============================================================
--  Ovea — Supabase schema
--  Run this in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run (uses "if not exists" / "or replace").
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- ADMINS  — who can moderate (see/hide/delete flagged content)
-- ------------------------------------------------------------
create table if not exists public.admins ( email text primary key );
-- Lock this table down: no direct API access. The is_admin() function below
-- (security definer) reads it safely on the server.
alter table public.admins enable row level security;

-- 👉 ADD YOUR EMAIL HERE (the Google/email account you'll moderate with):
-- insert into public.admins(email) values ('you@example.com') on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_admin() to authenticated, anon;

-- ------------------------------------------------------------
-- BANNED / HURTFUL WORDS  — content matching these is auto-flagged + hidden
-- Edit this list anytime (Table editor → banned_words). Whole-word match.
-- ------------------------------------------------------------
create table if not exists public.banned_words ( word text primary key );
-- Lock down: only reachable from the server-side flagging triggers, never the API.
alter table public.banned_words enable row level security;

insert into public.banned_words(word) values
  ('slut'), ('whore'), ('bitch'), ('cunt'),
  ('kys'), ('kill yourself'), ('kill urself'),
  ('worthless'), ('retard'), ('retarded'),
  ('ugly bitch'), ('die'), ('hate you')
on conflict do nothing;
-- Add more rows (including slurs you want blocked) as lowercase words/phrases.

-- ------------------------------------------------------------
-- PROFILES  — one per signed-in user (auto-created on signup)
-- Posts are shown as "Anonymous" publicly, but the DB knows the author
-- so you can ban a user or delete all their content.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  is_banned   boolean default false,
  created_at  timestamptz default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select using ( auth.uid() = id or public.is_admin() );

drop policy if exists "profiles update admin" on public.profiles;
create policy "profiles update admin" on public.profiles
  for update using ( public.is_admin() );

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helper: is the current user banned?
create or replace function public.is_banned()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_banned from public.profiles where id = auth.uid()), false);
$$;

-- ------------------------------------------------------------
-- POSTS
-- ------------------------------------------------------------
create table if not exists public.posts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users on delete cascade,
  community    text not null,
  title        text not null,
  body         text default '',
  score        int default 0,
  flagged      boolean default false,
  flag_reason  text,
  hidden       boolean default false,   -- hidden = withheld from public until a moderator approves
  report_count int default 0,
  author_name  text,                       -- null = posted anonymously; otherwise a display name
  created_at   timestamptz default now()
);
alter table public.posts enable row level security;
-- if the table already existed, add the new column:
alter table public.posts add column if not exists author_name text;

drop policy if exists "posts read" on public.posts;
create policy "posts read" on public.posts
  for select using ( hidden = false or auth.uid() = user_id or public.is_admin() );

drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts
  for insert with check ( auth.uid() = user_id and not public.is_banned() );

drop policy if exists "posts update own or admin" on public.posts;
create policy "posts update own or admin" on public.posts
  for update using ( auth.uid() = user_id or public.is_admin() );

drop policy if exists "posts delete own or admin" on public.posts;
create policy "posts delete own or admin" on public.posts
  for delete using ( auth.uid() = user_id or public.is_admin() );

-- ------------------------------------------------------------
-- COMMENTS
-- ------------------------------------------------------------
create table if not exists public.comments (
  id           bigint generated always as identity primary key,
  post_id      bigint not null references public.posts on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  body         text not null,
  flagged      boolean default false,
  flag_reason  text,
  hidden       boolean default false,
  report_count int default 0,
  author_name  text,                       -- null = posted anonymously; otherwise a display name
  created_at   timestamptz default now()
);
alter table public.comments enable row level security;
-- if the table already existed, add the new column:
alter table public.comments add column if not exists author_name text;

drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments
  for select using ( hidden = false or auth.uid() = user_id or public.is_admin() );

drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert with check ( auth.uid() = user_id and not public.is_banned() );

drop policy if exists "comments update own or admin" on public.comments;
create policy "comments update own or admin" on public.comments
  for update using ( auth.uid() = user_id or public.is_admin() );

drop policy if exists "comments delete own or admin" on public.comments;
create policy "comments delete own or admin" on public.comments
  for delete using ( auth.uid() = user_id or public.is_admin() );

-- ------------------------------------------------------------
-- VOTES  (score is recomputed by a trigger)
-- ------------------------------------------------------------
create table if not exists public.votes (
  user_id uuid   references auth.users on delete cascade,
  post_id bigint references public.posts on delete cascade,
  value   int not null check (value in (-1, 1)),
  primary key (user_id, post_id)
);
alter table public.votes enable row level security;

drop policy if exists "votes read own" on public.votes;
create policy "votes read own" on public.votes for select using ( auth.uid() = user_id );
drop policy if exists "votes insert own" on public.votes;
create policy "votes insert own" on public.votes for insert with check ( auth.uid() = user_id );
drop policy if exists "votes update own" on public.votes;
create policy "votes update own" on public.votes for update using ( auth.uid() = user_id );
drop policy if exists "votes delete own" on public.votes;
create policy "votes delete own" on public.votes for delete using ( auth.uid() = user_id );

create or replace function public.recalc_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid bigint;
begin
  pid := coalesce(new.post_id, old.post_id);
  update public.posts
     set score = coalesce((select sum(value) from public.votes where post_id = pid), 0)
   where id = pid;
  return null;
end; $$;

drop trigger if exists votes_after on public.votes;
create trigger votes_after
  after insert or update or delete on public.votes
  for each row execute function public.recalc_score();

-- ------------------------------------------------------------
-- AUTO-FLAGGING  — flag + hide content containing banned words
-- (whole-word match, case-insensitive)
-- ------------------------------------------------------------
create or replace function public.flag_post_if_bad()
returns trigger language plpgsql security definer set search_path = public as $$
declare bad text; content text;
begin
  content := lower(coalesce(new.title,'') || ' ' || coalesce(new.body,''));
  select word into bad from public.banned_words
   where content ~ ('\m' || word || '\M')
   limit 1;
  if bad is not null then
    new.flagged := true;
    new.flag_reason := 'auto: flagged language';
    new.hidden := true;   -- withhold from public until a moderator reviews
  end if;
  return new;
end; $$;

drop trigger if exists posts_flag on public.posts;
create trigger posts_flag before insert on public.posts
  for each row execute function public.flag_post_if_bad();

create or replace function public.flag_comment_if_bad()
returns trigger language plpgsql security definer set search_path = public as $$
declare bad text; content text;
begin
  content := lower(coalesce(new.body,''));
  select word into bad from public.banned_words
   where content ~ ('\m' || word || '\M')
   limit 1;
  if bad is not null then
    new.flagged := true;
    new.flag_reason := 'auto: flagged language';
    new.hidden := true;
  end if;
  return new;
end; $$;

drop trigger if exists comments_flag on public.comments;
create trigger comments_flag before insert on public.comments
  for each row execute function public.flag_comment_if_bad();

-- ------------------------------------------------------------
-- REPORTS  — users flag content; 2+ reports auto-hides pending review
-- ------------------------------------------------------------
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid references auth.users on delete set null,
  target_type text not null check (target_type in ('post','comment')),
  target_id   bigint not null,
  reason      text,
  created_at  timestamptz default now()
);
alter table public.reports enable row level security;

drop policy if exists "reports admin read" on public.reports;
create policy "reports admin read" on public.reports for select using ( public.is_admin() );

create or replace function public.report_content(p_type text, p_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_type = 'post' then
    update public.posts
       set report_count = report_count + 1,
           flagged = true,
           flag_reason = coalesce(flag_reason, 'user report'),
           hidden = (report_count + 1 >= 2) or hidden
     where id = p_id;
  elsif p_type = 'comment' then
    update public.comments
       set report_count = report_count + 1,
           flagged = true,
           flag_reason = coalesce(flag_reason, 'user report'),
           hidden = (report_count + 1 >= 2) or hidden
     where id = p_id;
  end if;
  insert into public.reports(reporter_id, target_type, target_id, reason)
    values (auth.uid(), p_type, p_id, p_reason);
end; $$;

grant execute on function public.report_content(text, bigint, text) to authenticated;

-- ------------------------------------------------------------
-- MODERATION HELPERS (admin only, enforced inside the function)
-- ------------------------------------------------------------
create or replace function public.moderate(p_type text, p_id bigint, p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if p_action = 'approve' then
    if p_type = 'post' then
      update public.posts set hidden = false, flagged = false, flag_reason = null where id = p_id;
    else
      update public.comments set hidden = false, flagged = false, flag_reason = null where id = p_id;
    end if;
  elsif p_action = 'delete' then
    if p_type = 'post' then delete from public.posts where id = p_id;
    else delete from public.comments where id = p_id; end if;
  end if;
end; $$;

grant execute on function public.moderate(text, bigint, text) to authenticated;

-- ============================================================
-- Done. Remember to:
--   1) insert your email into public.admins (top of this file)
--   2) enable Google + Email providers in Authentication → Providers
-- ============================================================
