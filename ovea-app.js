/* ============================================================
   Ovea, community app (Supabase-powered)
   Handles: auth (Google + email magic link), live feed, voting,
   comments, reporting, and the moderation queue.
   Loaded on: index.html (feed) and moderation.html (admin).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Communities (static catalog) ---------- */
  var COMMUNITIES = [
    { id: "periods",       name: "Periods & Cycles",        count: "" },
    { id: "body",          name: "Body & Puberty",          count: "" },
    { id: "mental",        name: "Mental Health",           count: "" },
    { id: "confidence",    name: "Body Image & Confidence", count: "" },
    { id: "relationships", name: "Friends & Relationships", count: "" },
    { id: "school",        name: "School & Stress",         count: "" },
    { id: "safety",        name: "Safety & Support",        count: "" },
    { id: "venting",       name: "Just Venting",            count: "" },
    { id: "other",         name: "Other",                   count: "" }
  ];
  var CMAP = {};
  COMMUNITIES.forEach(function (c) { CMAP[c.id] = c.name; });
  var HOUR = 3600 * 1000, DAY = 24 * HOUR;

  /* ---------- Supabase client ---------- */
  var sb = null, configured = false;
  function initClient() {
    var cfg = window.OVEA_CONFIG || {};
    configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("YOUR_") === -1 &&
                 cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf("YOUR_") === -1 &&
                 window.supabase && typeof window.supabase.createClient === "function";
    if (configured) {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
    return configured;
  }

  /* ---------- Session state ---------- */
  var session = null;        // supabase session or null
  var myVotes = {};          // { post_id: 1|-1 } for current user

  /* ---------- Helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function timeAgo(iso) {
    var ms = new Date(iso).getTime(), d = Date.now() - ms;
    if (isNaN(ms)) return "";
    if (d < 60000) return "just now";
    if (d < HOUR) return Math.floor(d / 60000) + "m ago";
    if (d < DAY) return Math.floor(d / HOUR) + "h ago";
    return Math.floor(d / DAY) + "d ago";
  }
  function userId() { return session && session.user ? session.user.id : null; }
  function userEmail() { return session && session.user ? session.user.email : ""; }

  /* Once a nickname exists, posting under it is the default and the field
     is prefilled, so nobody retypes it. With no nickname yet, anonymous
     stays the default rather than quietly attaching a name. */
  function syncNameFields() {
    var anon = document.getElementById("postAnon");
    var name = document.getElementById("postName");
    if (!anon || !name) return;
    var dn = displayName();
    anon.checked = !dn;
    name.value = dn;
    name.placeholder = dn ? "Display name" : "Pick a nickname, not your real name";
    name.style.display = anon.checked ? "none" : "";
  }

  /* Nickname kept on the account itself (auth user_metadata), so it is set
     once and follows you everywhere. No profiles column, and therefore no
     policy that could let someone edit their own is_banned flag. */
  function displayName() {
    var m = session && session.user ? (session.user.user_metadata || {}) : {};
    return (m.display_name || "").trim();
  }
  async function saveDisplayName(name) {
    name = (name || "").trim().slice(0, 30);
    if (!name || name === displayName()) return;
    var res = await sb.auth.updateUser({ data: { display_name: name } });
    if (!res.error && res.data && res.data.user) session.user = res.data.user;
  }

  /* ============================================================
     NOTIFICATIONS
     Replies other people leave on your posts. Votes can't be used:
     the "votes read own" policy means you can only see your own.
     ============================================================ */
  var NOTIF_SEEN = "ovea_notif_seen";
  var notifItems = [], notifTitles = {};

  function notifSeenAt() {
    try { return localStorage.getItem(NOTIF_SEEN) || ""; } catch (e) { return ""; }
  }
  function markNotifsSeen() {
    if (!notifItems.length) return;
    try { localStorage.setItem(NOTIF_SEEN, notifItems[0].created_at); } catch (e) {}
  }

  async function loadNotifications() {
    var wrap = document.getElementById("notifWrap");
    if (!wrap) return;
    if (!userId()) { wrap.style.display = "none"; return; }
    wrap.style.display = "";

    var mine = await sb.from("posts").select("id,title").eq("user_id", userId());
    var posts = mine.data || [];
    if (!posts.length) { notifItems = []; notifTitles = {}; return renderNotifications(); }

    notifTitles = {};
    posts.forEach(function (p) { notifTitles[p.id] = p.title; });
    var res = await sb.from("comments").select("*")
      .in("post_id", posts.map(function (p) { return p.id; }))
      .neq("user_id", userId())
      .order("created_at", { ascending: false })
      .limit(30);
    notifItems = res.data || [];
    renderNotifications();
  }

  function renderNotifications() {
    var badge = document.getElementById("notifBadge");
    var list = document.getElementById("notifList");
    if (!badge || !list) return;
    var seen = notifSeenAt();
    var unread = notifItems.filter(function (c) { return c.created_at > seen; }).length;
    badge.textContent = unread > 9 ? "9+" : unread;
    badge.style.display = unread ? "" : "none";
    var wrap = document.getElementById("notifWrap");
    if (wrap) wrap.classList.toggle("has-unread", !!unread);

    if (!notifItems.length) {
      list.innerHTML = '<div class="notif-empty">Nothing yet. When someone replies to one of your posts, it shows up here.</div>';
      return;
    }
    list.innerHTML = notifItems.map(function (c) {
      var isNew = c.created_at > seen;
      return '<button class="notif-item' + (isNew ? " unread" : "") + '" data-notif="' + c.post_id + '">' +
        '<div class="notif-line"><b>' + esc(c.author_name || "Anonymous") + "</b> replied to " +
          "<i>" + esc(notifTitles[c.post_id] || "your post") + "</i></div>" +
        '<div class="notif-snip">' + esc(c.body.length > 90 ? c.body.slice(0, 90) + "\u2026" : c.body) + "</div>" +
        '<div class="notif-when">' + timeAgo(c.created_at) + "</div>" +
      "</button>";
    }).join("");
  }

  /* jump to the post a notification refers to and open its thread */
  function openNotifTarget(postId) {
    var panel = document.getElementById("notifPanel");
    if (panel) panel.classList.remove("open");
    var go = function () {
      var article = document.querySelector('.post[data-id="' + postId + '"]');
      if (!article) return false;
      var l = article.querySelector("[data-clist]");
      if (l) l.classList.add("open");
      article.scrollIntoView({ behavior: "smooth", block: "center" });
      article.classList.add("flash");
      setTimeout(function () { article.classList.remove("flash"); }, 1600);
      return true;
    };
    if (go()) return;
    setCommunity("all");            // it may be filtered out of the current view
    setTimeout(go, 600);
  }

  function initNotifications() {
    var btn = document.getElementById("notifBtn");
    var panel = document.getElementById("notifPanel");
    if (!btn || !panel) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var opening = !panel.classList.contains("open");
      panel.classList.toggle("open");
      if (opening) { markNotifsSeen(); renderNotifications(); loadNotifications(); }
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#notifWrap")) panel.classList.remove("open");
    });
    panel.addEventListener("click", function (e) {
      var item = e.target.closest("[data-notif]");
      if (item) openNotifTarget(Number(item.getAttribute("data-notif")));
    });
  }

  /* ============================================================
     AUTH
     ============================================================ */
  function renderAccount() {
    var area = document.getElementById("accountArea");
    var createBtn = document.getElementById("createBtn");
    if (!area) return;
    if (session && session.user) {
      var isAnon = !userEmail() || session.user.is_anonymous;
      var initial = isAnon ? "A" : userEmail().charAt(0).toUpperCase();
      var who = isAnon ? "Signed in anonymously" : "Signed in as<br>" + esc(userEmail());
      area.innerHTML =
        '<div class="acct-wrap">' +
          '<button class="account-chip" id="acctBtn"><span class="av">' + esc(initial) + "</span> Account ▾</button>" +
          '<div class="account-menu" id="acctMenu">' +
            '<div class="who">' + who + "</div>" +
            '<div class="who" style="border-top:1px solid var(--line);margin-top:2px;padding-top:9px">' +
              (displayName() ? "Posting as <b>" + esc(displayName()) + "</b>" : "No nickname yet") + "</div>" +
            '<button id="nickBtn">' + (displayName() ? "Change nickname" : "Pick a nickname") + "</button>" +
            '<a href="index.html">Home feed</a>' +
            (window.OVEA_IS_ADMIN ? '<a href="moderation.html">Moderation queue</a>' : "") +
            '<button id="signOutBtn">Sign out</button>' +
          "</div>" +
        "</div>";
      var btn = document.getElementById("acctBtn"), menu = document.getElementById("acctMenu");
      btn.addEventListener("click", function (e) { e.stopPropagation(); menu.classList.toggle("open"); });
      document.addEventListener("click", function () { menu.classList.remove("open"); });
      document.getElementById("signOutBtn").addEventListener("click", function () {
        sb.auth.signOut();
      });
      var nickBtn = document.getElementById("nickBtn");
      if (nickBtn) nickBtn.addEventListener("click", async function () {
        var v = prompt("Pick a nickname to post under. It doesn't have to be your real name, and you can still post anonymously any time.", displayName());
        if (v === null) return;
        await saveDisplayName(v);
        renderAccount();
        syncNameFields();
        if (document.getElementById("feed")) loadFeed();
      });
      if (createBtn) createBtn.textContent = "Create post";
    } else {
      area.innerHTML = '<button class="nav-cta" id="signInBtn" style="border:0;cursor:pointer;font-family:inherit">Sign in</button>';
      document.getElementById("signInBtn").addEventListener("click", openAuth);
    }
  }

  function openAuth() {
    var m = document.getElementById("authModal");
    if (m) m.classList.add("open");
  }
  function closeAuth() {
    var m = document.getElementById("authModal");
    if (m) m.classList.remove("open");
  }

  function initAuthModal() {
    var modal = document.getElementById("authModal");
    if (!modal) return;
    modal.addEventListener("click", function (e) { if (e.target === modal) closeAuth(); });
    var closeBtn = document.getElementById("authClose");
    if (closeBtn) closeBtn.addEventListener("click", closeAuth);

    var googleBtn = document.getElementById("googleBtn");
    if (googleBtn) googleBtn.addEventListener("click", function () {
      if (!configured) return setAuthMsg("Supabase isn't configured yet, see SETUP.md.", "err");
      sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
    });

    var emailForm = document.getElementById("emailForm");
    if (emailForm) emailForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!configured) return setAuthMsg("Supabase isn't configured yet, see SETUP.md.", "err");
      var email = document.getElementById("emailInput").value.trim();
      if (!email) return;
      setAuthMsg("Sending your link…", "ok");
      sb.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      }).then(function (res) {
        if (res.error) setAuthMsg(res.error.message, "err");
        else setAuthMsg("Check your inbox, we sent you a sign-in link.", "ok");
      });
    });

    var anonBtn = document.getElementById("anonBtn");
    if (anonBtn) anonBtn.addEventListener("click", function () {
      if (!configured) return setAuthMsg("Supabase isn't configured yet, see SETUP.md.", "err");
      setAuthMsg("Setting you up…", "ok");
      sb.auth.signInAnonymously().then(function (res) {
        if (res.error) setAuthMsg(res.error.message, "err");
        // onAuthStateChange handles the rest (UI refresh + closing the modal)
      });
    });
  }
  function setAuthMsg(text, kind) {
    var el = document.getElementById("authMsg");
    if (el) { el.textContent = text; el.className = "auth-msg " + (kind || ""); }
  }

  /* check admin status (used to show moderation link / gate page) */
  function refreshAdminFlag() {
    window.OVEA_IS_ADMIN = false;
    if (!configured || !userId()) return Promise.resolve(false);
    // Ask the server (secure function) whether this user is a moderator.
    return sb.rpc("is_admin").then(function (res) {
      window.OVEA_IS_ADMIN = !res.error && res.data === true;
      return window.OVEA_IS_ADMIN;
    }).catch(function () { return false; });
  }

  /* ============================================================
     FEED
     ============================================================ */
  var state = { community: "all", sort: "hot", query: "" };

  function renderCommunities() {
    var el = document.getElementById("communityList");
    if (!el) return;
    var html = "<h4>Communities</h4>";
    COMMUNITIES.forEach(function (c) {
      html += '<button class="c-item" data-community="' + c.id + '">' +
        '<span class="c-dot"></span><span class="c-meta"><span class="c-name">' +
        esc(c.name) + "</span></span></button>";
    });
    el.innerHTML = html;
  }
  function renderCommunitySelect() {
    var sel = document.getElementById("postCommunity");
    if (!sel) return;
    // Leading placeholder so a topic is an actual choice, not whatever
    // happened to be first in the list. `required` on the <select> makes
    // the browser block submitting until one is picked.
    sel.innerHTML =
      '<option value="" disabled selected>Choose a topic…</option>' +
      COMMUNITIES.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + "</option>";
      }).join("");
  }
  // Words too common to be interesting as a trend
  var STOP = ("the a an and or but if then of to in on at for with about from into "
    + "is am are was were be been being do does did doing have has had i you he she it we they "
    + "me my mine your yours his her hers our their them us this that these those there here "
    + "not no yes so just like really very too also still even much more most some any all "
    + "im ive its dont cant wont didnt doesnt am pm get got out up down off over "
    + "can could would should will shall may might must want need know think feel feeling felt "
    + "what when where why how who which whom whose because as than then now today day days "
    + "time times people someone anyone everyone something anything nothing thing things "
    + "go going went come came back one two her she help please thanks thank").split(/\s+/);
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = true; });

  async function renderTrending() {
    var el = document.getElementById("trending");
    if (!el) return;
    var card = el.closest(".rail-card");
    if (!configured) { if (card) card.style.display = "none"; return; }

    var res = await sb.from("posts").select("title,body").order("created_at", { ascending: false }).limit(200);
    var posts = res.data || [];
    var counts = {};
    posts.forEach(function (p) {
      var words = ((p.title || "") + " " + (p.body || "")).toLowerCase().match(/[a-z][a-z']{2,}/g) || [];
      var seen = {};
      words.forEach(function (w) {
        w = w.replace(/'/g, "");
        if (w.length < 3 || STOPSET[w] || seen[w]) return;
        seen[w] = true;                 // count each word once per post
        counts[w] = (counts[w] || 0) + 1;
      });
    });
    var top = Object.keys(counts)
      .filter(function (w) { return counts[w] >= 2; })   // must appear in 2+ posts to "trend"
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, 8);

    if (!top.length) {
      // nothing trending yet, show communities to explore instead of making things up
      if (card) card.style.display = "none";
      return;
    }
    if (card) card.style.display = "";
    el.innerHTML = top.map(function (w) { return '<span class="t">#' + esc(w) + "</span>"; }).join("");
  }

  async function loadMyVotes() {
    myVotes = {};
    if (!userId()) return;
    var res = await sb.from("votes").select("post_id,value").eq("user_id", userId());
    if (!res.error && res.data) res.data.forEach(function (v) { myVotes[v.post_id] = v.value; });
  }

  async function loadFeed() {
    var feed = document.getElementById("feed");
    if (!feed) return;

    if (!configured) {
      feed.innerHTML =
        '<div class="config-banner"><b>Almost there.</b> Connect Supabase to turn on real accounts and live posts. ' +
        'Add your keys in <code>supabase-config.js</code> and run <code>supabase/schema.sql</code>, full steps in <code>SETUP.md</code>.</div>' +
        '<div class="feed-empty">The community feed will appear here once Supabase is connected.</div>';
      return;
    }

    feed.innerHTML = '<div class="feed-empty">Loading posts…</div>';

    var q = sb.from("posts").select("*");
    if (state.community !== "all" && state.community !== "popular") q = q.eq("community", state.community);

    // sorting
    if (state.sort === "new") q = q.order("created_at", { ascending: false });
    else if (state.sort === "top" || state.community === "popular") q = q.order("score", { ascending: false });
    else q = q.order("created_at", { ascending: false }); // hot re-sorted client-side
    q = q.limit(100);

    var res = await q;
    if (res.error) { feed.innerHTML = '<div class="feed-empty">Couldn\'t load posts: ' + esc(res.error.message) + "</div>"; return; }
    var posts = res.data || [];

    // client-side search filter
    if (state.query) {
      var qq = state.query.toLowerCase();
      posts = posts.filter(function (p) {
        return ((p.title || "") + " " + (p.body || "") + " " + (CMAP[p.community] || "")).toLowerCase().indexOf(qq) !== -1;
      });
    }
    // hot ranking
    if (state.sort === "hot" && state.community !== "popular") {
      posts.sort(function (a, b) {
        var ha = (a.score || 0) / Math.pow((Date.now() - new Date(a.created_at)) / HOUR + 2, 0.6);
        var hb = (b.score || 0) / Math.pow((Date.now() - new Date(b.created_at)) / HOUR + 2, 0.6);
        return hb - ha;
      });
    }

    if (!posts.length) {
      feed.innerHTML = state.query
        ? '<div class="feed-empty">Nothing matches &ldquo;' + esc(state.query) + '&rdquo;. ' +
          '<button class="link-btn" data-clearsearch>Show all posts</button></div>'
        : '<div class="feed-empty">No posts here yet. Be the first to speak up.</div>';
      return;
    }
    feed.innerHTML = posts.map(postHTML).join("");
    hydrateComments(posts);
  }

  function postHTML(p) {
    var mine = userId() && p.user_id === userId();
    var mv = myVotes[p.id] || 0;
    var flagNote = (p.hidden || p.flagged) && (mine || window.OVEA_IS_ADMIN)
      ? '<span class="flag-note">' + (p.hidden ? "Hidden, under review" : "Flagged") + "</span> " : "";
    return (
      '<article class="post' + (mine ? " mine" : "") + '" data-id="' + p.id +
        '" data-comm="' + esc(p.community) + '">' +
        '<div class="vote-col">' +
          '<button class="vote-btn up' + (mv === 1 ? " on" : "") + '" data-vote="1" aria-label="Upvote">▲</button>' +
          '<span class="score">' + (p.score || 0) + "</span>" +
          '<button class="vote-btn down' + (mv === -1 ? " on" : "") + '" data-vote="-1" aria-label="Downvote">▼</button>' +
        "</div>" +
        '<div class="post-main">' +
          '<div class="post-meta">' + flagNote +
            '<span class="pill" data-jump="' + p.community + '">' + esc(CMAP[p.community] || p.community) + "</span>" +
            "<span>· by " + esc(p.author_name || "Anonymous") + " ·</span><span>" + timeAgo(p.created_at) + "</span>" +
          "</div>" +
          '<h3 class="post-title" data-toggle>' + esc(p.title) + "</h3>" +
          (p.body ? '<div class="post-body">' + esc(p.body) + "</div>" : "") +
          '<div class="post-actions">' +
            '<button class="p-action" data-toggle>Comments</button>' +
            (mine || window.OVEA_IS_ADMIN ? '<button class="p-action" data-edit>' +
              (mine ? "Edit" : "Change topic") + "</button>" : "") +
            (mine || window.OVEA_IS_ADMIN ? '<button class="p-action danger" data-delete>Delete</button>' : "") +
            (mine ? "" : '<button class="p-action" data-report>Report</button>') +
          "</div>" +
          '<div class="comments open" data-comments></div>' +
        "</div>" +
      "</article>"
    );
  }

  async function applyVote(postId, dir) {
    if (!userId()) return openAuth();
    var cur = myVotes[postId] || 0;
    var article = document.querySelector('.post[data-id="' + postId + '"]');
    var scoreEl = article && article.querySelector(".score");
    var oldScore = scoreEl ? parseInt(scoreEl.textContent, 10) || 0 : 0;

    if (cur === dir) {
      // toggle off → delete vote
      myVotes[postId] = 0;
      if (scoreEl) scoreEl.textContent = oldScore - cur;
      updateVoteButtons(article, 0);
      await sb.from("votes").delete().eq("user_id", userId()).eq("post_id", postId);
    } else {
      myVotes[postId] = dir;
      if (scoreEl) scoreEl.textContent = oldScore - cur + dir;
      updateVoteButtons(article, dir);
      await sb.from("votes").upsert({ user_id: userId(), post_id: postId, value: dir });
    }
  }
  function updateVoteButtons(article, val) {
    if (!article) return;
    var up = article.querySelector(".vote-btn.up"), down = article.querySelector(".vote-btn.down");
    if (up) up.classList.toggle("on", val === 1);
    if (down) down.classList.toggle("on", val === -1);
  }

  function commentCountLabel(n) {
    return n === 0 ? "No comments yet" : n === 1 ? "1 comment" : n + " comments";
  }

  /* Pull the comments for every post on screen in a single query, so the
     replies are visible straight away instead of one click per post. */
  async function hydrateComments(posts) {
    if (!posts.length) return;
    var res = await sb.from("comments").select("*")
      .in("post_id", posts.map(function (p) { return p.id; }))
      .order("created_at", { ascending: true });
    var byPost = {};
    (res.data || []).forEach(function (c) { (byPost[c.post_id] = byPost[c.post_id] || []).push(c); });
    posts.forEach(function (p) {
      var article = document.querySelector('.post[data-id="' + p.id + '"]');
      if (!article) return;
      var cs = byPost[p.id] || [];
      renderComments(article.querySelector("[data-comments]"), cs);
      var btn = article.querySelector(".p-action[data-toggle]");
      if (btn) btn.textContent = commentCountLabel(cs.length);
    });
  }

  async function loadComments(article, postId) {
    var box = article.querySelector("[data-comments]");
    box.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:6px 0">Loading…</div>';
    var res = await sb.from("comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
    var cs = (res.data || []);
    var btn = article.querySelector(".p-action[data-toggle]");
    if (btn) btn.textContent = commentCountLabel(cs.length);
    renderComments(box, cs);
  }

  function renderComments(box, cs) {
    var compose = userId()
      ? '<div class="c-compose"><textarea placeholder="Add a supportive comment…"></textarea>' +
        '<button class="btn btn-primary" data-addcomment style="padding:9px 16px;align-self:flex-end">Reply</button></div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin:-6px 0 14px;flex-wrap:wrap">' +
          '<label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);cursor:pointer">' +
          '<input type="checkbox" data-canon' + (displayName() ? "" : " checked") +
            ' style="width:15px;height:15px;accent-color:var(--plum)" /> Comment anonymously</label>' +
          '<input type="text" data-cname maxlength="30" value="' + esc(displayName()) +
            '" placeholder="' + (displayName() ? "Display name" : "Pick a nickname") + '"' +
            (displayName() ? "" : ' style="display:none"') +
            ' class="cname-input" />' +
        "</div>"
      : '<div style="margin-bottom:12px"><button class="btn btn-ghost" data-needauth style="padding:9px 16px">Sign in to comment</button></div>';
    var list = cs.map(function (c) {
      var mine = userId() && c.user_id === userId();
      var note = (c.hidden || c.flagged) && (mine || window.OVEA_IS_ADMIN) ? '<span class="flag-note">' + (c.hidden ? "Hidden, under review" : "Flagged") + "</span> " : "";
      return '<div class="comment' + (mine ? " mine" : "") + '">' +
        '<div class="c-by">' + note + "<b>" + esc(c.author_name || "Anonymous") + "</b> · " + timeAgo(c.created_at) + "</div>" +
        '<div class="c-text">' + esc(c.body) + "</div></div>";
    }).join("");
    var wasOpen = box.querySelector("[data-clist].open") ? " open" : "";
    box.innerHTML = compose +
      '<div class="c-list' + wasOpen + '" data-clist>' +
        (list || '<div style="color:var(--muted);font-size:13px">No comments yet, be the first.</div>') +
      "</div>";
  }

  async function addComment(article, postId) {
    var ta = article.querySelector("[data-comments] textarea");
    var text = ta.value.trim();
    if (!text) return;
    var anonBox = article.querySelector("[data-comments] [data-canon]");
    var nameBox = article.querySelector("[data-comments] [data-cname]");
    var anon = !anonBox || anonBox.checked;
    var authorName = anon ? null : ((nameBox && nameBox.value.trim()) || displayName() || "Member");
    if (!anon && authorName && authorName !== "Member") await saveDisplayName(authorName);
    ta.disabled = true;
    var res = await sb.from("comments").insert({ post_id: postId, user_id: userId(), body: text, author_name: authorName });
    ta.disabled = false;
    if (res.error) { alert("Couldn't post comment: " + res.error.message); return; }
    await loadComments(article, postId);
    var list = article.querySelector("[data-clist]");   // show the reply you just left
    if (list) list.classList.add("open");
  }

  /* ---------- Edit / delete your own post ---------- */
  function cancelEdit(article) {
    var form = article.querySelector("[data-editform]");
    if (form) form.remove();
    var t = article.querySelector(".post-title");
    var b = article.querySelector(".post-body");
    if (t) t.style.display = "";
    if (b) b.style.display = "";
  }

  function topicOptions(current) {
    return COMMUNITIES.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === current ? " selected" : "") + ">" +
        esc(c.name) + "</option>";
    }).join("");
  }

  function startEdit(article, id) {
    if (article.querySelector("[data-editform]")) return;   // already editing
    var mine = article.classList.contains("mine");
    var titleEl = article.querySelector(".post-title");
    var bodyEl = article.querySelector(".post-body");
    var form = document.createElement("div");
    form.className = "edit-form";
    form.setAttribute("data-editform", "");

    var topic = '<select data-ecomm>' + topicOptions(article.getAttribute("data-comm")) + "</select>";
    // A moderator editing someone else's post can re-file it, but must not
    // rewrite her words, so only the topic is offered there.
    form.innerHTML =
      (mine
        ? topic +
          '<input type="text" data-etitle maxlength="140" value="' + esc(titleEl ? titleEl.textContent : "") + '" />' +
          '<textarea data-ebody maxlength="2000" placeholder="Add more detail (optional)">' +
            esc(bodyEl ? bodyEl.textContent : "") + "</textarea>"
        : '<div class="edit-note">Moderator: you can move this post to another topic. Only the author can change what it says.</div>' + topic) +
      '<div class="edit-actions">' +
        '<button class="btn btn-primary" data-savedit>Save changes</button>' +
        '<button class="p-action" data-canceledit>Cancel</button>' +
        '<span class="edit-msg" data-emsg></span>' +
      "</div>";
    if (mine) {
      if (titleEl) titleEl.style.display = "none";
      if (bodyEl) bodyEl.style.display = "none";
    }
    article.querySelector(".post-main").insertBefore(form, article.querySelector(".post-actions"));
    var first = form.querySelector(mine ? "[data-etitle]" : "[data-ecomm]");
    if (first) first.focus();
  }

  async function saveEdit(article, id) {
    var form = article.querySelector("[data-editform]");
    if (!form) return;
    var msg = form.querySelector("[data-emsg]");
    var titleEl = form.querySelector("[data-etitle]");
    var commEl = form.querySelector("[data-ecomm]");
    var patch = {};
    if (commEl) patch.community = commEl.value;
    if (titleEl) {                                  // author editing her own post
      var title = titleEl.value.trim();
      if (!title) { msg.textContent = "Your post needs a title."; return; }
      patch.title = title;
      patch.body = form.querySelector("[data-ebody]").value.trim();
    }
    msg.textContent = "Saving\u2026";
    var res = await sb.from("posts").update(patch).eq("id", id).select();
    if (res.error) { msg.textContent = "Couldn't save: " + res.error.message; return; }
    if (!res.data || !res.data.length) {            // RLS silently matched nothing
      msg.textContent = "You don't have permission to change this post.";
      return;
    }
    await loadFeed();
    renderTrending();
  }

  async function deletePost(article, id) {
    if (!confirm("Delete this post for good? This can't be undone.")) return;
    var res = await sb.from("posts").delete().eq("id", id);
    if (res.error) { alert("Couldn't delete: " + res.error.message); return; }
    article.remove();
    renderTrending();
  }

  async function reportContent(type, id) {
    if (!userId()) return openAuth();
    if (!confirm("Report this " + type + " to moderators?")) return;
    var res = await sb.rpc("report_content", { p_type: type, p_id: id, p_reason: "user report" });
    if (res.error) alert("Couldn't report: " + res.error.message);
    else alert("Thank you. A moderator will review this.");
  }

  function initFeed() {
    var feed = document.getElementById("feed");
    if (!feed) return;

    renderCommunities();
    renderCommunitySelect();
    renderTrending();
    loadFeed();

    // left rail + trending (delegated)
    document.addEventListener("click", function (e) {
      var c = e.target.closest(".c-item");
      if (c) {
        document.querySelectorAll(".c-item").forEach(function (b) { b.classList.remove("active"); });
        c.classList.add("active");
        setCommunity(c.getAttribute("data-community"));
      }
      var tag = e.target.closest(".tag-cloud .t");
      if (tag) doSearch(tag.textContent.replace(/^#/, ""));
    });

    document.querySelectorAll(".sort-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".sort-tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        state.sort = tab.getAttribute("data-sort");
        loadFeed();
      });
    });

    feed.addEventListener("click", function (e) {
      if (e.target.closest("[data-clearsearch]")) { clearSearch(); return; }
      var article = e.target.closest(".post");
      if (!article) return;
      var id = parseInt(article.getAttribute("data-id"), 10);

      var voteBtn = e.target.closest(".vote-btn");
      if (voteBtn) { applyVote(id, parseInt(voteBtn.getAttribute("data-vote"), 10)); return; }

      var jump = e.target.closest("[data-jump]");
      if (jump) {
        var cid = jump.getAttribute("data-jump");
        document.querySelectorAll(".c-item").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-community") === cid); });
        setCommunity(cid); return;
      }
      if (e.target.closest("[data-toggle]")) {
        var list = article.querySelector("[data-clist]");
        if (list) { list.classList.toggle("open"); return; }
        loadComments(article, id).then(function () {          // not hydrated yet
          var l = article.querySelector("[data-clist]");
          if (l) l.classList.add("open");
        });
        return;
      }
      if (e.target.closest("[data-canon]")) {
        var nm = article.querySelector("[data-comments] [data-cname]");
        if (nm) nm.style.display = e.target.checked ? "none" : "";
        return;
      }
      if (e.target.closest("[data-addcomment]")) { addComment(article, id); return; }
      if (e.target.closest("[data-needauth]")) { openAuth(); return; }
      if (e.target.closest("[data-edit]")) { startEdit(article, id); return; }
      if (e.target.closest("[data-savedit]")) { saveEdit(article, id); return; }
      if (e.target.closest("[data-canceledit]")) { cancelEdit(article); return; }
      if (e.target.closest("[data-delete]")) { deletePost(article, id); return; }
      if (e.target.closest("[data-report]")) { reportContent("post", id); return; }
    });

    // composer
    var composerForm = document.getElementById("composerForm");
    var openInput = document.getElementById("composerOpen");
    var createBtn = document.getElementById("createBtn");
    function openComposer() {
      if (!userId()) return openAuth();
      composerForm.classList.add("open");
      syncNameFields();
      document.getElementById("postTitle").focus();
    }
    if (openInput) openInput.addEventListener("click", openComposer);
    if (createBtn) createBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (!userId()) return openAuth();
      openComposer();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    var cancel = document.getElementById("composerCancel");
    if (cancel) cancel.addEventListener("click", function () { composerForm.classList.remove("open"); });

    // show/hide the display-name field based on the "post anonymously" checkbox
    var postAnon = document.getElementById("postAnon");
    var postName = document.getElementById("postName");
    if (postAnon && postName) postAnon.addEventListener("change", function () {
      postName.style.display = postAnon.checked ? "none" : "";
      if (!postAnon.checked && !postName.value) postName.value = displayName();
    });

    if (composerForm) composerForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!userId()) return openAuth();
      var title = document.getElementById("postTitle").value.trim();
      var body = document.getElementById("postBody").value.trim();
      var community = document.getElementById("postCommunity").value;
      var anon = document.getElementById("postAnon").checked;
      var authorName = anon ? null : (document.getElementById("postName").value.trim() || displayName() || "Member");
      if (!anon && authorName && authorName !== "Member") await saveDisplayName(authorName);
      if (!title) return;
      if (!community) { document.getElementById("postCommunity").focus(); return; }
      var res = await sb.from("posts").insert({ user_id: userId(), community: community, title: title, body: body, author_name: authorName }).select().single();
      if (res.error) { alert("Couldn't post: " + res.error.message); return; }
      // author auto-upvote
      if (res.data) { await sb.from("votes").upsert({ user_id: userId(), post_id: res.data.id, value: 1 }); myVotes[res.data.id] = 1; }
      composerForm.reset();
      if (postName) postName.style.display = "none";
      composerForm.classList.remove("open");
      if (res.data && res.data.hidden) {
        alert("Your post mentions language our filter caught, so it's hidden until a moderator reviews it.");
      }
      state.sort = "new";
      document.querySelectorAll(".sort-tab").forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-sort") === "new"); });
      await loadFeed();
      renderTrending();
      window.scrollTo({ top: 220, behavior: "smooth" });
    });

    var nav = document.getElementById("navSearch");
    if (nav) nav.addEventListener("input", function () { doSearch(nav.value); });
    var chip = document.getElementById("filterChip");
    if (chip) chip.addEventListener("click", function () { clearSearch(); });
  }

  function setCommunity(id) {
    state.community = id;
    clearSearch(true);          // picking a community shouldn't keep a stale filter
    var title = id === "all" ? "Home" : id === "popular" ? "Popular" : (CMAP[id] || "Home");
    var t = document.getElementById("feedTitle");
    if (t) t.textContent = title;
    loadFeed();
  }

  /* Show what the feed is filtered by, and give an obvious way out. */
  function renderFilterChip() {
    var chip = document.getElementById("filterChip");
    if (!chip) return;
    if (!state.query) { chip.style.display = "none"; return; }
    chip.style.display = "";
    chip.innerHTML = esc(state.query) + '<span class="fx">\u00d7</span>';
  }

  function clearSearch(skipReload) {
    state.query = "";
    var nav = document.getElementById("navSearch");
    if (nav) nav.value = "";
    renderFilterChip();
    if (!skipReload) loadFeed();
  }

  function doSearch(q) {
    state.query = q.trim();
    var nav = document.getElementById("navSearch");
    if (nav && nav.value !== state.query) nav.value = state.query;   // keep the box in sync
    renderFilterChip();
    loadFeed();
  }

  /* ============================================================
     MODERATION PAGE
     ============================================================ */
  async function initModeration() {
    var root = document.getElementById("modRoot");
    if (!root) return;

    if (!configured) {
      root.innerHTML = '<div class="mod-gate"><h2 style="font-family:var(--serif);color:var(--plum-deep)">Not configured</h2>' +
        '<p style="color:var(--muted)">Connect Supabase first (see SETUP.md).</p></div>';
      return;
    }
    if (!userId()) {
      root.innerHTML = '<div class="mod-gate"><h2 style="font-family:var(--serif);color:var(--plum-deep)">Moderators only</h2>' +
        '<p style="color:var(--muted);margin:12px 0 20px">Please sign in with your moderator account.</p>' +
        '<button class="btn btn-primary" id="modSignIn">Sign in</button></div>';
      document.getElementById("modSignIn").addEventListener("click", openAuth);
      return;
    }
    await refreshAdminFlag();
    if (!window.OVEA_IS_ADMIN) {
      root.innerHTML = '<div class="mod-gate"><h2 style="font-family:var(--serif);color:var(--plum-deep)">Access denied</h2>' +
        '<p style="color:var(--muted)">This account (' + esc(userEmail()) + ') isn\'t a moderator. ' +
        'Add it to the <code>admins</code> table in Supabase.</p></div>';
      return;
    }
    await renderModQueue();
  }

  async function renderModQueue() {
    var root = document.getElementById("modRoot");
    root.innerHTML =
      '<div class="mod-wrap"><div class="mod-head">' +
        '<h1 style="font-family:var(--serif);color:var(--plum-deep);font-size:26px">Moderation queue</h1>' +
        '<a href="index.html" class="btn btn-ghost" style="padding:9px 16px">Back to feed</a>' +
      "</div><div id=\"modList\"><div class=\"mod-empty\">Loading…</div></div></div>";

    var postsRes = await sb.from("posts").select("*").or("flagged.eq.true,hidden.eq.true").order("report_count", { ascending: false });
    var commentsRes = await sb.from("comments").select("*").or("flagged.eq.true,hidden.eq.true").order("report_count", { ascending: false });
    var items = [];
    (postsRes.data || []).forEach(function (p) { items.push({ type: "post", row: p }); });
    (commentsRes.data || []).forEach(function (c) { items.push({ type: "comment", row: c }); });

    var list = document.getElementById("modList");
    if (!items.length) { list.innerHTML = '<div class="mod-empty">Nothing to review. The community is clean.</div>'; return; }

    list.innerHTML = items.map(function (it) {
      var r = it.row;
      var title = it.type === "post" ? esc(r.title) : "Comment on post #" + r.post_id;
      var body = it.type === "post" ? esc(r.body || "") : esc(r.body);
      return '<div class="mod-item" data-type="' + it.type + '" data-id="' + r.id + '">' +
        '<div class="m-meta"><span class="m-reason">' + esc(r.flag_reason || "flagged") + "</span>" +
          "<span>· " + esc(CMAP[r.community] || it.type) + "</span>" +
          "<span>· reports: " + (r.report_count || 0) + "</span>" +
          "<span>· " + (r.hidden ? "hidden" : "visible") + "</span></div>" +
        "<h3>" + title + "</h3>" +
        '<div class="m-body">' + body + "</div>" +
        '<div class="m-actions">' +
          '<button class="btn btn-approve" data-action="approve">Approve (publish)</button>' +
          '<button class="btn btn-delete" data-action="delete">Delete</button>' +
        "</div></div>";
    }).join("");

    list.addEventListener("click", async function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var item = btn.closest(".mod-item");
      var type = item.getAttribute("data-type"), id = parseInt(item.getAttribute("data-id"), 10);
      var action = btn.getAttribute("data-action");
      if (action === "delete" && !confirm("Permanently delete this " + type + "?")) return;
      btn.disabled = true;
      var res = await sb.rpc("moderate", { p_type: type, p_id: id, p_action: action });
      if (res.error) { alert("Action failed: " + res.error.message); btn.disabled = false; return; }
      item.style.opacity = ".4";
      item.querySelector(".m-actions").innerHTML = "<span style='color:var(--muted);font-size:13px'>" + (action === "approve" ? "Published." : "Deleted.") + "</span>";
    });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  async function boot() {
    initClient();
    initAuthModal();

    if (!configured) {
      renderAccount();
      initFeed();
      initModeration();
      return;
    }

    // initial session
    var s = await sb.auth.getSession();
    session = s.data ? s.data.session : null;
    await refreshAdminFlag();
    await loadMyVotes();
    renderAccount();
    loadNotifications();

    // react to auth changes (sign in / out / magic-link redirect)
    sb.auth.onAuthStateChange(async function (_event, newSession) {
      session = newSession;
      await refreshAdminFlag();
      await loadMyVotes();
      renderAccount();
      loadNotifications();
      closeAuth();
      if (document.getElementById("feed")) loadFeed();
      if (document.getElementById("modRoot")) initModeration();
    });

    initFeed();
    initNotifications();
    initModeration();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
