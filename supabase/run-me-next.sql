-- ============================================================
--  Ovea, pending database fixes
--  Paste the whole file into Supabase → SQL Editor → Run.
--  Safe to run more than once.
-- ============================================================

-- 1) FIXES THE COMMENT ERROR ---------------------------------
-- The app sends author_name with every comment (it is how a comment
-- shows a display name instead of "Anonymous"), but the column was
-- never added to the live comments table, so every reply failed with
-- "Could not find the 'author_name' column of 'comments'".
alter table public.comments add column if not exists author_name text;


-- 2) STOP HIDING POSTS FROM GIRLS IN DISTRESS ----------------
-- A match on these words hides the post pending review, so someone
-- writing "I feel worthless" or "I want to die" was silently removed
-- from the feed. "die" also catches ordinary speech ("I could die of
-- embarrassment") and "hate you" catches venting.
delete from public.banned_words
 where word in ('die', 'worthless', 'hate you');


-- 3) RUN THE WORD FILTER ON EDITS ----------------------------
-- The filter only ran BEFORE INSERT, so editing a post skipped it
-- entirely. "update of title, body" means it fires only when the text
-- changes, so a moderator approving a post does not re-hide it.
drop trigger if exists posts_flag on public.posts;
create trigger posts_flag
  before insert or update of title, body on public.posts
  for each row execute function public.flag_post_if_bad();

drop trigger if exists comments_flag on public.comments;
create trigger comments_flag
  before insert or update of body on public.comments
  for each row execute function public.flag_comment_if_bad();
