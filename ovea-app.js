/* ============================================================
   Ovea — community app (Supabase-powered)
   Handles: auth (Google + email magic link), live feed, voting,
   comments, reporting, and the moderation queue.
   Loaded on: index.html (feed) and moderation.html (admin).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Communities (static catalog) ---------- */
  var COMMUNITIES = [
    { id: "periods",       name: "Periods & Cycles",      count: "" },
    { id: "mental",        name: "Mental Health",         count: "" },
    { id: "relationships", name: "Relationships",         count: "" },
    { id: "pregnancy",     name: "Pregnancy & Parenting", count: "" },
    { id: "body",          name: "Body & Hygiene",        count: "" },
    { id: "menopause",     name: "Menopause",             count: "" },
    { id: "work",          name: "Work & Money",          count: "" },
    { id: "safety",        name: "Safety & Support",      count: "" },
    { id: "venting",       name: "Just Venting",          count: "" },
    { id: "wins",          name: "Small Wins",            count: "" }
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

  /* ============================================================
     AUTH
     ============================================================ */
  function renderAccount() {
    var area = document.getElementById("accountArea");
    var createBtn = document.getElementById("createBtn");
    if (!area) return;
    if (session && session.user) {
      var initial = (userEmail() || "?").charAt(0).toUpperCase();
      area.innerHTML =
        '<div class="acct-wrap">' +
          '<button class="account-chip" id="acctBtn"><span class="av">' + esc(initial) + "</span> Account ▾</button>" +
          '<div class="account-menu" id="acctMenu">' +
            '<div class="who">Signed in as<br>' + esc(userEmail()) + "</div>" +
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
      if (!configured) return setAuthMsg("Supabase isn't configured yet — see SETUP.md.", "err");
      sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
    });

    var emailForm = document.getElementById("emailForm");
    if (emailForm) emailForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!configured) return setAuthMsg("Supabase isn't configured yet — see SETUP.md.", "err");
      var email = document.getElementById("emailInput").value.trim();
      if (!email) return;
      setAuthMsg("Sending your link…", "ok");
      sb.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      }).then(function (res) {
        if (res.error) setAuthMsg(res.error.message, "err");
        else setAuthMsg("Check your inbox — we sent you a sign-in link.", "ok");
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
    sel.innerHTML = COMMUNITIES.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + "</option>";
    }).join("");
  }
  function renderTrending() {
    var el = document.getElementById("trending");
    if (!el) return;
    var tags = ["Speaking up", "Boundaries", "Self-care", "Small wins", "Perimenopause", "Trust your gut"];
    el.innerHTML = tags.map(function (t) { return '<span class="t">#' + esc(t.replace(/\s/g, "")) + "</span>"; }).join("");
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
        'Add your keys in <code>supabase-config.js</code> and run <code>supabase/schema.sql</code> — full steps in <code>SETUP.md</code>.</div>' +
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
      feed.innerHTML = '<div class="feed-empty">No posts here yet. Be the first to speak up.</div>';
      return;
    }
    feed.innerHTML = posts.map(postHTML).join("");
  }

  function postHTML(p) {
    var mine = userId() && p.user_id === userId();
    var mv = myVotes[p.id] || 0;
    var flagNote = (p.hidden || p.flagged) && (mine || window.OVEA_IS_ADMIN)
      ? '<span class="flag-note">' + (p.hidden ? "Hidden — under review" : "Flagged") + "</span> " : "";
    return (
      '<article class="post' + (mine ? " mine" : "") + '" data-id="' + p.id + '">' +
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
            '<button class="p-action" data-report>Report</button>' +
          "</div>" +
          '<div class="comments" data-comments></div>' +
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

  async function loadComments(article, postId) {
    var box = article.querySelector("[data-comments]");
    box.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:6px 0">Loading…</div>';
    var res = await sb.from("comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
    var cs = (res.data || []);
    var compose = userId()
      ? '<div class="c-compose"><textarea placeholder="Add a supportive comment…"></textarea>' +
        '<button class="btn btn-primary" data-addcomment style="padding:9px 16px;align-self:flex-end">Reply</button></div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin:-6px 0 14px;flex-wrap:wrap">' +
          '<label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);cursor:pointer">' +
          '<input type="checkbox" data-canon checked style="width:15px;height:15px;accent-color:var(--plum)" /> Comment anonymously</label>' +
          '<input type="text" data-cname maxlength="30" placeholder="Display name" style="display:none;padding:7px 11px;border:1.5px solid var(--line);border-radius:9px;font-family:var(--font);font-size:13px;background:var(--cream)" />' +
        "</div>"
      : '<div style="margin-bottom:12px"><button class="btn btn-ghost" data-needauth style="padding:9px 16px">Sign in to comment</button></div>';
    var list = cs.map(function (c) {
      var mine = userId() && c.user_id === userId();
      var note = (c.hidden || c.flagged) && (mine || window.OVEA_IS_ADMIN) ? '<span class="flag-note">' + (c.hidden ? "Hidden — under review" : "Flagged") + "</span> " : "";
      return '<div class="comment' + (mine ? " mine" : "") + '">' +
        '<div class="c-by">' + note + "<b>" + esc(c.author_name || "Anonymous") + "</b> · " + timeAgo(c.created_at) + "</div>" +
        '<div class="c-text">' + esc(c.body) + "</div></div>";
    }).join("");
    box.innerHTML = compose + (list || '<div style="color:var(--muted);font-size:13px">No comments yet — be the first.</div>');
  }

  async function addComment(article, postId) {
    var ta = article.querySelector("[data-comments] textarea");
    var text = ta.value.trim();
    if (!text) return;
    var anonBox = article.querySelector("[data-comments] [data-canon]");
    var nameBox = article.querySelector("[data-comments] [data-cname]");
    var anon = !anonBox || anonBox.checked;
    var authorName = anon ? null : ((nameBox && nameBox.value.trim()) || "Member");
    ta.disabled = true;
    var res = await sb.from("comments").insert({ post_id: postId, user_id: userId(), body: text, author_name: authorName });
    ta.disabled = false;
    if (res.error) { alert("Couldn't post comment: " + res.error.message); return; }
    await loadComments(article, postId);
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
        var box = article.querySelector("[data-comments]");
        if (box.classList.contains("open")) box.classList.remove("open");
        else { box.classList.add("open"); loadComments(article, id); }
        return;
      }
      if (e.target.closest("[data-canon]")) {
        var nm = article.querySelector("[data-comments] [data-cname]");
        if (nm) nm.style.display = e.target.checked ? "none" : "";
        return;
      }
      if (e.target.closest("[data-addcomment]")) { addComment(article, id); return; }
      if (e.target.closest("[data-needauth]")) { openAuth(); return; }
      if (e.target.closest("[data-report]")) { reportContent("post", id); return; }
    });

    // composer
    var composerForm = document.getElementById("composerForm");
    var openInput = document.getElementById("composerOpen");
    var createBtn = document.getElementById("createBtn");
    function openComposer() {
      if (!userId()) return openAuth();
      composerForm.classList.add("open");
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
    });

    if (composerForm) composerForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!userId()) return openAuth();
      var title = document.getElementById("postTitle").value.trim();
      var body = document.getElementById("postBody").value.trim();
      var community = document.getElementById("postCommunity").value;
      var anon = document.getElementById("postAnon").checked;
      var authorName = anon ? null : (document.getElementById("postName").value.trim() || "Member");
      if (!title) return;
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
      window.scrollTo({ top: 220, behavior: "smooth" });
    });

    var nav = document.getElementById("navSearch");
    if (nav) nav.addEventListener("input", function () { doSearch(nav.value); });
  }

  function setCommunity(id) {
    state.community = id;
    var title = id === "all" ? "Home" : id === "popular" ? "Popular" : (CMAP[id] || "Home");
    var t = document.getElementById("feedTitle");
    if (t) t.textContent = title;
    loadFeed();
  }
  function doSearch(q) { state.query = q.trim(); loadFeed(); }

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

    // react to auth changes (sign in / out / magic-link redirect)
    sb.auth.onAuthStateChange(async function (_event, newSession) {
      session = newSession;
      await refreshAdminFlag();
      await loadMyVotes();
      renderAccount();
      closeAuth();
      if (document.getElementById("feed")) loadFeed();
      if (document.getElementById("modRoot")) initModeration();
    });

    initFeed();
    initModeration();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
