-- ============================================================
--  Ovea, banned words
--  ------------------------------------------------------------
--  Paste this whole file into: Supabase Dashboard → SQL Editor → Run.
--  (The table is locked by RLS and is NOT reachable from the browser,
--   so it can only be edited here or in the Table editor.)
--
--  How it works: on insert, a trigger lowercases the title + body and
--  looks for a WHOLE-WORD match against this list. A match sets
--  flagged = true and hidden = true, so the post is withheld from the
--  public feed until a moderator approves it in moderation.html.
--
--  Because a match HIDES the post, only put things here that should
--  genuinely be held back. Do NOT add words that describe distress
--  ("worthless", "hopeless", "die") — a girl writing "I feel worthless"
--  needs support, and silently hiding her post is the opposite of that.
--  Abuse aimed AT someone ("kys") belongs here; pain expressed about
--  oneself does not.
-- ============================================================

insert into public.banned_words(word) values

  -- ---- targeted abuse / harassment ----------------------------
  ('kys'), ('kysf'), ('kill yourself'), ('kill urself'), ('kill ur self'),
  ('neck yourself'), ('nobody likes you'), ('no one likes you'),
  ('hate you'), ('shut up bitch'),

  -- ---- gendered insults ---------------------------------------
  ('slut'), ('slutty'), ('whore'), ('hoe'), ('thot'),
  ('bitch'), ('bitches'), ('cunt'), ('skank'),

  -- ---- ableist slurs ------------------------------------------
  ('retard'), ('retarded'), ('sped'), ('spastic'),

  -- ---- racial / ethnic slurs ----------------------------------
  ('nigger'), ('nigga'), ('niggers'), ('chink'), ('gook'), ('spic'),
  ('wetback'), ('kike'), ('paki'), ('coon'), ('towelhead'),

  -- ---- homophobic / transphobic slurs -------------------------
  ('faggot'), ('fagot'), ('fag'), ('dyke'), ('tranny'), ('shemale'),

  -- ---- pro-eating-disorder content ----------------------------
  -- Serious on a site with a body image section. These glorify
  -- restriction rather than discuss recovery, so they get reviewed.
  ('thinspo'), ('thinspiration'), ('bonespo'), ('meanspo'),
  ('pro ana'), ('proana'), ('pro-ana'), ('pro mia'), ('promia'),
  ('ana coach'), ('ana buddy'), ('goal weight'), ('ugw'),

  -- ---- contact solicitation / grooming risk -------------------
  -- Anyone trying to move a minor off-platform into a private DM.
  ('send nudes'), ('send pics'), ('send me pics'), ('send me nudes'),
  ('snap me'), ('add my snap'), ('my snap is'), ('kik me'), ('my kik'),
  ('dm me'), ('text me at'), ('whatsapp me'), ('my number is'),

  -- ---- sexual content aimed at users --------------------------
  ('horny'), ('sexy pics'), ('nudes'),

  -- ---- spam / scams -------------------------------------------
  ('onlyfans'), ('only fans'), ('cashapp'), ('venmo me'),
  ('crypto'), ('bitcoin'), ('free gift card'), ('click my link'),
  ('promo code'), ('dm for promo')

on conflict do nothing;

-- Check what's live:
--   select word from public.banned_words order by word;
-- Remove one:
--   delete from public.banned_words where word = 'hoe';
