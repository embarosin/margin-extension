/* ============================================================================
   Margin site — tab routing + a self-contained, faithful in-page demo of the
   extension. No build step, no dependencies. The demo re-implements the real
   Margin interactions (control bar, comment/browse modes, pins, threaded
   sidebar, composer, AI, team badge) against a mock product page so visitors
   can try it before installing.
   ========================================================================== */
(function () {
  "use strict";

  // tiny DOM helper
  function el(tag, props, kids) {
    const n = document.createElement(tag);
    if (props)
      for (const k in props) {
        if (k === "class") n.className = props[k];
        else if (k === "html") n.innerHTML = props[k];
        else if (k === "text") n.textContent = props[k];
        else if (k.startsWith("on") && typeof props[k] === "function")
          n.addEventListener(k.slice(2), props[k]);
        else if (props[k] != null) n.setAttribute(k, props[k]);
      }
    (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach((c) =>
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
    );
    return n;
  }
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ------------------------------ tab routing ------------------------------ */
  const panels = [...document.querySelectorAll("[data-panel]")];
  const tabs = [...document.querySelectorAll(".tab")];
  function show(name) {
    panels.forEach((p) => (p.hidden = p.dataset.panel !== name));
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    if (name === "demo") demo.start();
  }
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));
  document.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.goto))
  );
  window.addEventListener("hashchange", () => {
    const h = location.hash.replace("#", "");
    if (["about", "demo", "privacy"].includes(h)) show(h);
  });

  /* =========================================================================
     THE DEMO
     ========================================================================= */
  const demo = (function () {
    const stage = document.getElementById("demo-stage");
    const page = document.getElementById("mock-page");
    let started = false;
    let uiBuilt = false;

    // state
    const S = {
      mode: "comment", // 'comment' | 'browse'
      filter: "open", // 'open' | 'all'
      sidebarOpen: true,
      team: false,
      threads: [],
      nextNum: 1,
      summary: null,
      composer: null, // { anchorEl, quote, x, y }
      teammateCursor: null,
    };

    // refs to built UI
    let control, sidebar, listEl, countEl, filterChip, hover, toolbar, composer, pinLayer, teamBadge, connectBtn, countBtn;

    const PALETTE = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];
    const ME = { name: "You", color: "#6366f1" };
    const MAYA = { name: "Maya", color: "#ec4899" };
    const initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

    function start() {
      if (started) return;
      started = true;
      build();
      seed();
      render();
    }

    /* --------------------------- build the UI ---------------------------- */
    function build() {
      if (uiBuilt) return;
      uiBuilt = true;

      pinLayer = el("div", { class: "mg-pin-layer" });
      hover = el("div", { class: "mg-hover" });
      stage.appendChild(pinLayer);
      stage.appendChild(hover);

      // control bar
      const browseBtn = el("button", { text: "🖱 Browse", title: "Use the page normally", onclick: () => setMode("browse") });
      const commentBtn = el("button", { class: "on", text: "💬 Comment", title: "Click anything to comment", onclick: () => setMode("comment") });
      const seg = el("div", { class: "mg-seg" }, [browseBtn, commentBtn]);
      connectBtn = el("button", { class: "mg-connect", text: "🔌 Connect demo team", onclick: connectTeam });
      teamBadge = el("button", { class: "mg-control-team", html: '<span class="mg-team-dot"></span>Team: connected ✓', title: "Comments sync with your team (demo)" });
      countBtn = el("button", { class: "mg-control-btn", title: "Toggle comments", onclick: () => toggleSidebar() }, [
        "💬 ", el("span", { class: "mg-control-count", text: "0" }),
      ]);
      control = el("div", { class: "mg-control" }, [
        el("span", { class: "mg-control-brand" }, [el("span", { class: "logo", text: "✦" }), "Margin"]),
        seg,
        el("span", { class: "mg-control-hint", text: "highlight text to comment" }),
        connectBtn,
        teamBadge,
        countBtn,
      ]);
      control._browse = browseBtn;
      control._comment = commentBtn;
      control._count = countBtn.querySelector(".mg-control-count");
      stage.appendChild(control);

      // selection toolbar
      const selBtn = el("button", { class: "mg-sel-btn", text: "💬 Comment" });
      toolbar = el("div", { class: "mg-toolbar" }, [selBtn]);
      selBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const range = sel.getRangeAt(0);
        const r = range.getBoundingClientRect();
        const host = closestLabel(range.commonAncestorContainer);
        const sr = stage.getBoundingClientRect();
        const quote = sel.toString().trim();
        sel.removeAllRanges();
        toolbar.style.display = "none";
        openComposer(host, quote, r.left + r.width / 2 - sr.left, r.bottom - sr.top);
      });
      stage.appendChild(toolbar);

      // composer
      const ta = el("textarea", { class: "mg-composer-input", rows: "3", placeholder: "Leave a comment…  (⌘/Ctrl+Enter)" });
      const snippet = el("div", { class: "mg-composer-snippet" });
      const post = el("button", { class: "mg-btn mg-btn-primary", text: "Comment", onclick: submitComposer });
      const cancel = el("button", { class: "mg-btn mg-btn-ghost", text: "Cancel", onclick: closeComposer });
      composer = el("div", { class: "mg-composer" }, [snippet, ta, el("div", { class: "mg-composer-actions" }, [cancel, post])]);
      composer._ta = ta;
      composer._snip = snippet;
      ta.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitComposer(); }
        if (e.key === "Escape") closeComposer();
        e.stopPropagation();
      });
      stage.appendChild(composer);

      // sidebar
      countEl = el("span", { class: "mg-count", text: "0" });
      filterChip = el("button", { class: "mg-chip", text: "Open", title: "Toggle resolved", onclick: toggleFilter });
      const sumBtn = el("button", { class: "mg-chip", text: "✨ Summary", onclick: summarize });
      const closeBtn = el("button", { class: "mg-icon-btn", text: "✕", title: "Close", onclick: () => toggleSidebar(false) });
      const head = el("div", { class: "mg-side-head" }, [
        el("div", { class: "mg-side-title" }, [el("span", { class: "mg-logo", text: "✦" }), el("span", { text: "Margin" }), countEl]),
        el("div", { class: "mg-side-tools" }, [filterChip, sumBtn, closeBtn]),
      ]);
      listEl = el("div", { class: "mg-side-list" });
      sidebar = el("div", { class: "mg-side", "data-open": "true" }, [head, listEl]);
      stage.appendChild(sidebar);

      // interactions on the mock page
      page.addEventListener("mousemove", onMove, true);
      page.addEventListener("click", onClick, true);
      page.addEventListener("scroll", reposition, true);
      document.addEventListener("mouseup", () => setTimeout(updateToolbar, 0));
      window.addEventListener("resize", reposition);

      // reset button
      const resetBtn = document.getElementById("demo-reset");
      if (resetBtn) resetBtn.addEventListener("click", reset);
    }

    /* ----------------------------- helpers ------------------------------- */
    function closestLabel(node) {
      let n = node && node.nodeType === 3 ? node.parentNode : node;
      while (n && n !== page && !(n.getAttribute && n.getAttribute("data-label"))) n = n.parentNode;
      return n && n.getAttribute && n.getAttribute("data-label") ? n : null;
    }
    function rel(elm) {
      const r = elm.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return { left: r.left - s.left, top: r.top - s.top, width: r.width, height: r.height };
    }
    const commenting = () => S.mode === "comment" && !S.composer;

    /* --------------------------- hover target ---------------------------- */
    function onMove(e) {
      if (!commenting()) { hover.style.display = "none"; return; }
      const t = e.target.closest("[data-label]");
      if (!t) { hover.style.display = "none"; return; }
      const p = rel(t);
      Object.assign(hover.style, { display: "block", left: p.left + "px", top: p.top + "px", width: p.width + "px", height: p.height + "px" });
    }

    function onClick(e) {
      if (!commenting()) return;
      const t = e.target.closest("[data-label]");
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const p = rel(t);
      hover.style.display = "none";
      openComposer(t, t.getAttribute("data-label"), p.left + p.width / 2, p.top + p.height);
    }

    /* --------------------------- selection ------------------------------- */
    function updateToolbar() {
      if (S.composer) { toolbar.style.display = "none"; return; }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim() || !page.contains(sel.anchorNode)) {
        toolbar.style.display = "none";
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      toolbar.style.display = "block";
      toolbar.style.left = Math.max(6, r.left + r.width / 2 - s.left - 55) + "px";
      toolbar.style.top = Math.max(6, r.top - s.top - 42) + "px";
    }

    /* --------------------------- composer -------------------------------- */
    function openComposer(anchorEl, quote, x, y) {
      S.composer = { anchorEl, quote };
      composer._snip.textContent = "Commenting on: " + (quote ? "“" + quote.slice(0, 60) + "”" : "this area");
      composer.style.display = "block";
      const cw = 280, ch = 150;
      composer.style.left = Math.max(8, Math.min(x, stage.clientWidth - cw - 8)) + "px";
      composer.style.top = Math.max(8, Math.min(y + 8, stage.clientHeight - ch - 8)) + "px";
      composer._ta.value = "";
      setTimeout(() => composer._ta.focus(), 0);
    }
    function closeComposer() {
      S.composer = null;
      composer.style.display = "none";
    }
    function submitComposer() {
      const text = composer._ta.value.trim();
      if (!text || !S.composer) return;
      const { anchorEl, quote } = S.composer;
      closeComposer();
      const th = {
        id: "t" + Date.now(),
        num: S.nextNum++,
        anchorEl: anchorEl || page.querySelector(".mock-hero h1"),
        quote: quote || "this area",
        resolved: false,
        comments: [{ author: ME, body: text, kind: "human", at: Date.now() }],
      };
      S.threads.push(th);
      S.sidebarOpen = true;
      render();
      flashThread(th.id);
      toast("Comment added ✓");
    }

    /* ----------------------------- modes --------------------------------- */
    function setMode(m) {
      S.mode = m === "browse" ? "browse" : "comment";
      stage.classList.toggle("mg-cursor", S.mode === "comment");
      if (S.mode !== "comment") hover.style.display = "none";
      control._browse.classList.toggle("on", S.mode === "browse");
      control._comment.classList.toggle("on", S.mode === "comment");
    }
    function toggleSidebar(force) {
      S.sidebarOpen = force == null ? !S.sidebarOpen : force;
      sidebar.setAttribute("data-open", String(S.sidebarOpen));
    }
    function toggleFilter() {
      S.filter = S.filter === "open" ? "all" : "open";
      filterChip.textContent = S.filter === "open" ? "Open" : "All";
      filterChip.classList.toggle("mg-chip-on", S.filter === "all");
      render();
    }

    /* ------------------------------ team --------------------------------- */
    function connectTeam() {
      S.team = true;
      connectBtn.style.display = "none";
      teamBadge.classList.add("on");
      toast("Connected to demo team ✓");
      // a teammate cursor wanders the page, then leaves a reply
      S.teammateCursor = el("div", { class: "mg-demo-cursor" }, [el("div", { class: "arrow" }), el("div", { class: "label", text: "Maya" })]);
      stage.appendChild(S.teammateCursor);
      const spots = [[120, 120], [360, 230], [520, 180], [300, 360], [180, 300]];
      let i = 0;
      const moveCursor = () => {
        if (!S.team || !S.teammateCursor) return;
        const [x, y] = spots[i % spots.length];
        S.teammateCursor.style.left = x + "px";
        S.teammateCursor.style.top = y + "px";
        i++;
        if (i <= spots.length) setTimeout(moveCursor, 700);
        else setTimeout(mayaReplies, 600);
      };
      setTimeout(moveCursor, 200);
    }
    function mayaReplies() {
      const open = S.threads.filter((t) => !t.resolved);
      const target = open[0];
      if (target) {
        target.comments.push({ author: MAYA, body: "Good catch — I'll take this one. Pushing a fix now. 👍", kind: "human", at: Date.now() });
        render();
        flashThread(target.id);
      }
      toast("Maya replied");
      if (S.teammateCursor) { S.teammateCursor.remove(); S.teammateCursor = null; }
    }

    /* ------------------------------ AI ----------------------------------- */
    function askAI(th) {
      const ai = { author: { name: "Margin AI", color: "#7c3aed" }, body: "", kind: "ai", pending: true, at: Date.now() };
      th.comments.push(ai);
      render();
      setTimeout(() => {
        ai.pending = false;
        ai.body = aiAnswer(th);
        render();
        flashThread(th.id);
      }, 1100);
    }
    function aiAnswer(th) {
      const label = (th.quote || "this element").toLowerCase();
      return (
        "Looking at the page, the “" + th.quote + "” sits in the hero above the fold. " +
        "Two quick wins: tighten the copy to one clear verb-led action, and make sure the contrast " +
        "ratio clears 4.5:1 for accessibility. If this is the primary CTA, it should be the most " +
        "prominent button on the screen — consider increasing its size or spacing.\n\n" +
        "(Demo response — in the real extension this is grounded in the live page via your own Claude/GPT/Gemini key.)"
      );
    }
    function summarize() {
      S.summary = { loading: true };
      render();
      setTimeout(() => {
        const open = S.threads.filter((t) => !t.resolved);
        const items = open.length
          ? open.map((t) => "<li><b>" + esc(t.quote) + "</b> — " + esc((t.comments[0] && t.comments[0].body) || "") + "</li>").join("")
          : "<li>No open feedback — you're all caught up.</li>";
        S.summary = { html: "<b>Prioritized from " + open.length + " open thread" + (open.length === 1 ? "" : "s") + ":</b><ul>" + items + "</ul><p style='margin-top:6px;color:#7c3aed'>(Demo summary — the real AI ranks by impact across every comment.)</p>" };
        render();
      }, 1000);
    }

    /* ----------------------------- render -------------------------------- */
    function render() {
      // pins
      pinLayer.innerHTML = "";
      S.threads.forEach((t) => {
        const pin = el("button", { class: "mg-pin" + (t.resolved ? " mg-pin-resolved" : ""), text: String(t.num) });
        pin.style.setProperty("--mg-pin-color", (t.comments[0] && t.comments[0].author.color) || "#6366f1");
        pin.dataset.pin = t.id;
        pin.addEventListener("click", () => { toggleSidebar(true); flashThread(t.id, true); });
        pinLayer.appendChild(pin);
        t._pin = pin;
      });
      reposition();

      // counts
      const openCount = S.threads.filter((t) => !t.resolved).length;
      countEl.textContent = String(openCount);
      control._count.textContent = String(openCount);

      // list
      listEl.innerHTML = "";
      if (S.summary) listEl.appendChild(renderSummary());
      const visible = S.threads.filter((t) => (S.filter === "open" ? !t.resolved : true));
      if (!visible.length) {
        listEl.appendChild(S.threads.length ? caughtUp() : firstRun());
        return;
      }
      visible.forEach((t) => listEl.appendChild(renderThread(t)));
    }

    function reposition() {
      S.threads.forEach((t) => {
        if (!t._pin || !t.anchorEl || !t.anchorEl.isConnected) { if (t._pin) t._pin.style.display = "none"; return; }
        const p = rel(t.anchorEl);
        const onScreen = p.top + p.height > 0 && p.top < stage.clientHeight;
        t._pin.style.display = onScreen ? "flex" : "none";
        t._pin.style.left = Math.max(2, Math.min(p.left - 12, stage.clientWidth - 30)) + "px";
        t._pin.style.top = Math.max(2, p.top - 12) + "px";
      });
    }

    function firstRun() {
      const inComment = S.mode === "comment";
      const cta = el("button", { class: "mg-btn mg-btn-primary mg-empty-cta", text: inComment ? "Click anything on the page →" : "Start commenting", onclick: () => { setMode("comment"); render(); } });
      return el("div", { class: "mg-empty" }, [
        el("div", { class: "mg-empty-icon", text: "💬" }),
        el("div", { class: "mg-empty-title", text: "Leave the first comment" }),
        el("div", { class: "mg-empty-sub", text: inComment ? "You’re in Comment mode. Click any element above — or highlight some text — to pin your first note." : "Switch to Comment mode, then click any element or highlight text. Your comment pins to the page and shows up here." }),
        cta,
        el("div", { class: "mg-empty-tip", text: "Comments save automatically — no account needed." }),
      ]);
    }
    function caughtUp() {
      return el("div", { class: "mg-empty" }, [
        el("div", { class: "mg-empty-icon", text: "✅" }),
        el("div", { class: "mg-empty-title", text: "All caught up" }),
        el("div", { class: "mg-empty-sub", text: "No open comments on this page." }),
        el("button", { class: "mg-btn mg-btn-ghost mg-empty-cta", text: "Show resolved", onclick: () => { if (S.filter === "open") toggleFilter(); } }),
      ]);
    }

    function renderSummary() {
      const body = S.summary.loading
        ? el("div", { class: "mg-ai-thinking", text: "✨ Summarizing feedback…" })
        : el("div", { html: S.summary.html });
      return el("div", { class: "mg-summary" }, [
        el("div", { class: "mg-summary-head" }, [el("span", { text: "✨ Feedback summary" }), el("button", { class: "mg-icon-btn", text: "✕", onclick: () => { S.summary = null; render(); } })]),
        body,
      ]);
    }

    function renderThread(t) {
      const head = el("div", { class: "mg-th-head", onclick: () => flashPin(t.id) }, [
        el("span", { class: "mg-th-num", text: String(t.num) }),
        el("span", { class: "mg-th-anchor", title: t.quote, text: "“" + t.quote.slice(0, 46) + (t.quote.length > 46 ? "…" : "") + "”" }),
      ]);

      const comments = el("div", {}, t.comments.map((c) => renderComment(c)));

      const ta = el("textarea", { class: "mg-reply-input", rows: "1", placeholder: "Reply…" });
      ta.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); reply(t, ta); }
        e.stopPropagation();
      });
      const replyBtn = el("button", { class: "mg-btn mg-btn-primary mg-btn-sm", text: "Reply", onclick: () => reply(t, ta) });
      const aiBtn = el("button", { class: "mg-btn mg-btn-ai mg-btn-sm", text: "✨ Ask AI", onclick: () => askAI(t) });
      const resolveBtn = el("button", { class: "mg-btn mg-btn-ghost mg-btn-sm", text: t.resolved ? "Reopen" : "Resolve", onclick: () => { t.resolved = !t.resolved; render(); } });
      const delBtn = el("button", { class: "mg-icon-btn", title: "Delete", text: "🗑", onclick: () => { S.threads = S.threads.filter((x) => x !== t); render(); } });

      const replyRow = el("div", { class: "mg-reply" }, [
        ta,
        el("div", { class: "mg-reply-actions" }, [resolveBtn, el("span", { class: "mg-spacer" }), delBtn, aiBtn, replyBtn]),
      ]);

      return el("div", { class: "mg-th" + (t.resolved ? " mg-th-resolved" : ""), "data-th": t.id }, [head, comments, replyRow]);
    }

    function renderComment(c) {
      const isAI = c.kind === "ai";
      const a = isAI ? { name: "Margin AI", color: "#7c3aed" } : c.author;
      const av = isAI ? el("span", { class: "mg-avatar mg-avatar-ai", text: "✦" }) : (() => { const x = el("span", { class: "mg-avatar", text: initials(a.name) }); x.style.background = a.color; return x; })();
      const body = c.pending
        ? el("div", { class: "mg-ai-thinking", text: "✨ Margin AI is thinking…" })
        : el("div", { class: "mg-c-body", html: esc(c.body).replace(/\n/g, "<br>") });
      return el("div", { class: "mg-c" + (isAI ? " mg-c-ai" : "") }, [
        el("div", { class: "mg-c-head" }, [av, el("span", { class: "mg-c-name", text: a.name }), el("span", { class: "mg-c-time", text: "just now" })]),
        body,
      ]);
    }

    function reply(t, ta) {
      const text = ta.value.trim();
      if (!text) return;
      t.comments.push({ author: ME, body: text, kind: "human", at: Date.now() });
      if (t.resolved) t.resolved = false;
      render();
      flashThread(t.id);
    }

    /* ---------------------------- flourishes ----------------------------- */
    function flashPin(id) {
      const t = S.threads.find((x) => x.id === id);
      if (!t || !t._pin) return;
      t._pin.classList.add("mg-pin-flash");
      setTimeout(() => t._pin && t._pin.classList.remove("mg-pin-flash"), 1200);
    }
    function flashThread(id, scroll) {
      const card = listEl.querySelector('[data-th="' + id + '"]');
      flashPin(id);
      if (card) {
        if (scroll) card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("mg-th-flash");
        setTimeout(() => card.classList.remove("mg-th-flash"), 1200);
      }
    }
    function toast(msg) {
      const t = el("div", { class: "mg-toast", text: msg });
      stage.appendChild(t);
      requestAnimationFrame(() => t.classList.add("show"));
      setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 250); }, 1800);
    }

    /* ------------------------------ seed --------------------------------- */
    function seed() {
      const anchor = page.querySelector('[data-label="Get started button"]');
      S.threads = [
        {
          id: "seed1",
          num: S.nextNum++,
          anchorEl: anchor,
          quote: "Get started free",
          resolved: false,
          comments: [
            { author: { name: "Sam", color: "#3b82f6" }, body: "Can we make this button bigger? It’s the main action but the “Watch demo” next to it competes with it.", kind: "human", at: Date.now() },
            { author: ME, body: "Agreed — I’ll bump the size and add some spacing.", kind: "human", at: Date.now() },
          ],
        },
      ];
    }

    function reset() {
      S.threads = [];
      S.nextNum = 1;
      S.summary = null;
      S.filter = "open";
      S.team = false;
      filterChip.textContent = "Open";
      filterChip.classList.remove("mg-chip-on");
      teamBadge.classList.remove("on");
      connectBtn.style.display = "";
      if (S.teammateCursor) { S.teammateCursor.remove(); S.teammateCursor = null; }
      closeComposer();
      setMode("comment");
      toggleSidebar(true);
      seed();
      render();
      toast("Demo reset ↺");
    }

    return { start };
  })();

  /* --------------------------- initial route --------------------------- */
  const initial = location.hash.replace("#", "");
  show(["about", "demo", "privacy"].includes(initial) ? initial : "about");
})();
