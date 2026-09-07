-- ============================================================
--  Ovea, run the word filter on edits too
--  ------------------------------------------------------------
--  Paste into: Supabase Dashboard → SQL Editor → Run.
--
--  The auto-flag trigger only ran BEFORE INSERT, so once posts and
--  comments became editable, anyone could publish something harmless
--  and then edit slurs or contact details into it, and the filter
--  would never see the change.
--
--  "update of title, body" matters: it means the trigger fires only
--  when the text itself changes. A moderator approving a post sets
--  hidden = false without touching the text, so approving does NOT
--  re-hide the post.
-- ============================================================

drop trigger if exists posts_flag on public.posts;
create trigger posts_flag
  before insert or update of title, body on public.posts
  for each row execute function public.flag_post_if_bad();

drop trigger if exists comments_flag on public.comments;
create trigger comments_flag
  before insert or update of body on public.comments
  for each row execute function public.flag_comment_if_bad();
