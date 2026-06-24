/* ============================================================
   Ovea — shared site logic (footer, nav, and static pages)
   The community feed + auth lives in ovea-app.js (Supabase).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Shared footer ---------- */
  function injectFooter() {
    var mount = document.getElementById("footer");
    if (!mount) return;
    mount.outerHTML =
      '<footer class="site-footer"><div class="wrap">' +
      '<div class="footer-grid">' +
      '<div><a class="brand" href="index.html"><span class="mark"></span><span class="name">Ovea</span></a>' +
      '<p class="about">A safe, anonymous community where women speak up, share, and support each other.</p></div>' +
      '<div class="footer-col"><h4>Community</h4>' +
      '<a href="index.html">Home feed</a><a href="resources.html">Health Info</a><a href="feedback.html">Feedback</a></div>' +
      '<div class="footer-col"><h4>Support</h4>' +
      '<a href="support.html">Get Help</a><a href="support.html">Crisis Resources</a><a href="about.html">About</a><a href="donate.html">Support Ovea</a></div>' +
      '<div class="footer-col"><h4>Connect</h4>' +
      '<a href="#">Instagram</a><a href="#">TikTok</a><a href="mailto:hello@ovea.community">hello@ovea.community</a></div>' +
      "</div>" +
      '<div class="footer-bottom">' +
      "<span>© 2026 Ovea. A space for women, by women.</span>" +
      "<span>Ovea is peer support, not medical advice. In an emergency, contact local services.</span>" +
      "</div></div></footer>";
  }

  /* ---------- Mobile nav ---------- */
  function initNav() {
    var toggle = document.getElementById("navToggle");
    var links = document.getElementById("navLinks");
    if (toggle && links) toggle.addEventListener("click", function () { links.classList.toggle("open"); });
  }

  /* ---------- Scroll reveal ---------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("in"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---------- Newsletter ---------- */
  function initNewsletter() {
    var form = document.getElementById("newsForm");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = document.getElementById("newsMsg");
      if (!document.getElementById("newsEmail").value.trim()) return;
      msg.textContent = "Thank you for subscribing — welcome to the Ovea community!";
      form.reset();
    });
  }

  /* ---------- Health-info search (resources page) ---------- */
  function filterResList(q) {
    var list = document.getElementById("resList");
    var empty = document.getElementById("resEmpty");
    if (!list) return;
    q = (q || "").trim().toLowerCase();
    var groups = list.querySelectorAll(".res-group");
    var links = list.querySelectorAll(".res-link");
    var anyShown = false;
    links.forEach(function (a) {
      var hay = (a.textContent + " " + (a.getAttribute("data-topic") || "")).toLowerCase();
      var show = !q || hay.indexOf(q) !== -1;
      a.style.display = show ? "" : "none";
      if (show) anyShown = true;
    });
    groups.forEach(function (g) {
      var sib = g.nextElementSibling, visible = false;
      while (sib && sib.classList.contains("res-link")) {
        if (sib.style.display !== "none") visible = true;
        sib = sib.nextElementSibling;
      }
      g.style.display = visible ? "" : "none";
    });
    if (empty) empty.style.display = anyShown ? "none" : "block";
  }
  function initFind() {
    var bar = document.getElementById("findBar");
    var input = document.getElementById("findInput");
    var onResources = !!document.getElementById("resList");
    if (onResources) {
      var params = new URLSearchParams(window.location.search);
      var q = params.get("q") || "";
      if (input) input.value = q;
      filterResList(q);
      if (input) input.addEventListener("input", function () { filterResList(input.value); });
    }
    if (!bar) return;
    bar.addEventListener("submit", function (e) {
      e.preventDefault();
      var val = input ? input.value.trim() : "";
      if (onResources) filterResList(val);
      else window.location.href = "resources.html" + (val ? "?q=" + encodeURIComponent(val) : "");
    });
  }

  /* ---------- Events RSVP ---------- */
  function initEvents() {
    document.querySelectorAll(".event .rsvp").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.classList.contains("done")) return;
        btn.classList.add("done", "btn-ghost");
        btn.classList.remove("btn-primary");
        btn.textContent = "Reserved";
      });
    });
  }

  /* ---------- Feedback ---------- */
  function initFeedback() {
    var form = document.getElementById("feedbackForm");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = document.getElementById("fbMsg");
      if (!document.getElementById("fbMessage").value.trim()) {
        msg.className = "form-msg err";
        msg.textContent = "Please share a little about your idea before sending.";
        return;
      }
      form.reset();
      msg.className = "form-msg ok";
      msg.textContent = "Thank you! Your feedback has been received — we read every message.";
    });
  }

  /* ---------- Donate ---------- */
  function initDonate() {
    var tiers = document.getElementById("tiers");
    if (!tiers) return;
    var custom = document.getElementById("customAmt");
    var label = document.getElementById("donateAmtLabel");
    var freq = document.getElementById("donateFreq");
    var selected = 25;
    function updateLabel() {
      var amt = custom.value ? Number(custom.value) : selected;
      if (!amt || amt < 1) amt = selected;
      label.textContent = "$" + amt + (freq && freq.value === "monthly" ? "/mo" : "");
    }
    tiers.addEventListener("click", function (e) {
      var tier = e.target.closest(".tier");
      if (!tier) return;
      tiers.querySelectorAll(".tier").forEach(function (t) { t.classList.remove("active"); });
      tier.classList.add("active");
      selected = Number(tier.getAttribute("data-amt"));
      custom.value = "";
      updateLabel();
    });
    custom.addEventListener("input", function () {
      tiers.querySelectorAll(".tier").forEach(function (t) { t.classList.remove("active"); });
      updateLabel();
    });
    if (freq) freq.addEventListener("change", updateLabel);
    document.getElementById("donateForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var amt = custom.value ? Number(custom.value) : selected;
      var msg = document.getElementById("donateMsg");
      if (!amt || amt < 1) { msg.className = "form-msg err"; msg.textContent = "Please choose or enter an amount."; return; }
      msg.className = "form-msg ok";
      msg.textContent = "Thank you for your generosity! Your $" + amt +
        (freq && freq.value === "monthly" ? " each month" : "") +
        " gift helps keep Ovea free and safe. (Demo — no payment taken.)";
      e.target.reset();
      updateLabel();
    });
    updateLabel();
  }

  /* ---------- boot ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    injectFooter();
    initNav();
    initReveal();
    initNewsletter();
    initFind();
    initEvents();
    initFeedback();
    initDonate();
  });
})();
