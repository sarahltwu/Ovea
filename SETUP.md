# Ovea — Setup Guide

This turns Ovea from a demo into a real community with **accounts, a real database, and moderation**.
You'll do this once. No coding required — just clicking and pasting.

There are 3 parts:
1. **Supabase** — your database + login system (free)
2. **Connect the site** — paste 2 keys
3. **Host it** — put it online so login works (free)

Budget ~20–30 minutes.

---

## Part 1 — Create your Supabase project

1. Go to **https://supabase.com** → **Start your project** → sign up (free).
2. Click **New project**. Give it a name (e.g. `ovea`), set a database password (save it somewhere), pick a region near your users, and create it. Wait ~2 minutes for it to finish setting up.

### 1a. Create the database tables
1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Open the file `supabase/schema.sql` from this project, copy **everything**, paste it into the editor.
3. **Before running**, find this line near the top and make it your email (the account you'll log in with to moderate):
   ```sql
   -- insert into public.admins(email) values ('you@example.com') on conflict do nothing;
   ```
   Remove the leading `-- ` and change the email, so it reads:
   ```sql
   insert into public.admins(email) values ('YOUR-EMAIL@gmail.com') on conflict do nothing;
   ```
4. Click **Run**. You should see "Success". This creates posts, comments, votes, reports, the auto-flagging filter, and your moderator access.

### 1b. Turn on login (Google + email link)

**Our live values (reuse these exactly):**
- Supabase callback URL: `https://ltpzbebisvecjhefgfao.supabase.co/auth/v1/callback`
- Live site URL: `https://ovea.sarahsophiaovea.workers.dev`

1. **Email link** — Authentication → Providers → make sure **Email** is **enabled**. No other setup; powers the "email me a link" button.

2. **Google** — first create credentials in Google Cloud:
   - **https://console.cloud.google.com** → create/select a project (`Ovea`).
   - **APIs & Services → OAuth consent screen** → **External** → fill app name `Ovea` + your emails.
     Click **Publish app** so anyone (not just test users) can sign in.
   - **APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application**.
     - **Authorized JavaScript origins:**
       `https://ovea.sarahsophiaovea.workers.dev` and `https://ltpzbebisvecjhefgfao.supabase.co`
     - **Authorized redirect URIs** (the Supabase callback, NOT the site):
       `https://ltpzbebisvecjhefgfao.supabase.co/auth/v1/callback`
   - Create → copy the **Client ID** + **Client Secret**.
   - Supabase → Authentication → Providers → **Google** → enable, paste both, **Save**.

3. **Authentication → URL Configuration**:
   - **Site URL:** `https://ovea.sarahsophiaovea.workers.dev`
   - **Redirect URLs:** add `https://ovea.sarahsophiaovea.workers.dev/**`

---

## Part 2 — Connect the site to Supabase

1. In Supabase, go to **Project Settings → API**.
2. Copy two values:
   - **Project URL** (e.g. `https://abcdxyz.supabase.co`)
   - **anon public** key (a long string — *not* the `service_role` key)
3. Open `supabase-config.js` in this project and paste them in:
   ```js
   window.OVEA_CONFIG = {
     SUPABASE_URL: "https://abcdxyz.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi...your-long-anon-key..."
   };
   ```
   > The anon key is **safe to put in the browser** — your data is protected by the security rules in `schema.sql`.

---

## Part 3 — Put it online (so login works)

Login can't work from a file on your computer — it needs a real `https://` address.

We host the code on **GitHub**, then connect **Cloudflare Pages** to that repo so every
push auto-deploys. The project is already a git repo with one commit.

### 3a. Put the code on GitHub
1. Go to **https://github.com/new** and create a repo named **`ovea`**. Leave it empty
   (no README, no .gitignore — this project already has them). You can make it Public or Private.
2. Copy the repo URL GitHub shows you (e.g. `https://github.com/YOUR-USERNAME/ovea.git`).
3. In a terminal, from the `Ovea` folder, run:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/ovea.git
   git push -u origin main
   ```
   GitHub will ask you to sign in (a browser prompt or a Personal Access Token). After this,
   your code is on GitHub.

   > Later, to publish any change: `git add -A && git commit -m "update" && git push`

### 3b. Connect Cloudflare Pages to GitHub
1. Go to **https://dash.cloudflare.com** → sign up (free).
2. **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git**.
3. Authorize Cloudflare to access GitHub, then pick your **`ovea`** repo.
4. Build settings — this is a plain static site, so:
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`  (just a slash — the files are in the repo root)
5. **Save and Deploy.** You'll get a URL like `https://ovea.pages.dev`.

Every future `git push` to `main` now redeploys automatically.

### 3c. Point Supabase at your live URL (required for login)
**Supabase → Authentication → URL Configuration**:
- **Site URL** = your Cloudflare URL (e.g. `https://ovea.pages.dev`)
- **Redirect URLs** = the same URL. Save.

(If you set up Google login, also add that URL to the Google Cloud **Authorized redirect URIs**.)

That's it — open your `.pages.dev` URL and sign in.

> Want a custom domain (e.g. `ovea.org`)? In your Pages project → **Custom domains** → add it,
> then update the Supabase Site URL + Redirect URLs to match.

---

## How moderation works

You asked for: posts go live without pre-approval, but hurtful ones get caught. Here's what happens:

- **Normal posts/comments publish instantly.**
- **Auto-flag filter:** if a post or comment contains a word in your `banned_words` list, it's **hidden from everyone** and sent to your review queue. (Edit that list anytime in Supabase → **Table Editor → banned_words**. Add lowercase words/phrases — whole-word matches.)
- **User reports:** anyone can click **Report** on a post. After **2 reports**, the item is auto-hidden pending your review. (One report flags it for you but keeps it visible.)

### Where you moderate — two options
1. **In-app queue (easiest):** visit **`/moderation.html`** on your site and sign in with your moderator email. You'll see every flagged/hidden item with **Approve (publish)** or **Delete** buttons.
2. **Supabase dashboard:** **Table Editor → posts** (or **comments**). Sort by `flagged` or `report_count`. You can edit or delete any row directly. The `reports` table shows who reported what.

### Add more moderators
Supabase → **Table Editor → admins → Insert row** → add their email. (They must sign in with that email.)

### Ban a user
Their posts are stored with a hidden `user_id`. In **profiles**, set `is_banned = true` for that id to stop them posting/commenting. To find the id, look at the `user_id` on their post.

---

## Notes & limits
- The word filter is a **starter** — expand `banned_words` for your community. It catches whole words, so it won't flag "class" for containing "ass," but it also won't catch creative misspellings. Reports + your review cover the rest.
- Everything public-facing is **anonymous** — members never see names or emails. You (admin) can see `user_id`s in the database for safety/moderation only.
- This is **peer support, not medical advice.** The Get Help page lists real crisis resources.

Stuck on any step? Tell me where you are and I'll walk you through it.
