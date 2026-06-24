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
1. Go to **Authentication → Providers**.
2. **Email**: make sure it's **enabled** (it usually is). This powers the "email me a link" sign-in. No extra setup.
3. **Google**: toggle it on. It will ask for a **Client ID** and **Client Secret**. Get these from Google:
   - Go to **https://console.cloud.google.com** → create a project (or pick one).
   - **APIs & Services → OAuth consent screen** → set it up (External, add your app name + email).
   - **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
   - Under **Authorized redirect URIs**, add the callback URL shown on the Supabase Google provider page (looks like `https://YOUR-PROJECT.supabase.co/auth/v1/callback`).
   - Copy the generated **Client ID** and **Client Secret** back into Supabase and **Save**.
4. Go to **Authentication → URL Configuration** and set:
   - **Site URL**: your live site address (you'll have this after Part 3 — e.g. `https://ovea.pages.dev`). For testing you can temporarily use it once you have it.
   - **Redirect URLs**: add the same site URL (and `http://localhost:3000` if you test locally with a server).

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

**Cloudflare Pages — drag-and-drop**
1. Go to **https://dash.cloudflare.com** → sign up (free).
2. In the left sidebar, click **Workers & Pages** → **Create** → **Pages** tab → **Upload assets**.
3. Give the project a name (e.g. `ovea`). This becomes part of your URL.
4. **Drag the whole `Ovea` folder** (or select all the files inside it) into the upload box → **Deploy site**.
5. You'll get a URL like `https://ovea.pages.dev`.
6. Go back to **Supabase → Authentication → URL Configuration** and set:
   - **Site URL** = your Cloudflare URL (e.g. `https://ovea.pages.dev`)
   - **Redirect URLs** = the same URL. Save.
7. (If you set up Google login, also add that URL to the Google Cloud **Authorized redirect URIs**.)

That's it — open your `.pages.dev` URL and sign in.

> To update the site later, come back to the same Pages project → **Create deployment** → drag the folder again. (Or connect a GitHub repo for automatic deploys on every push.)

> Want a custom domain (e.g. `ovea.org`)? In your Pages project → **Custom domains** → add it, then update the Supabase Site URL + Redirect URLs to match.

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
