/* My voice vs. my AI clone: page behaviour.
   Every number shown comes from data/measures.json; raster geometry from data/figures.json. */
(() => {
  "use strict";

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs = {}) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    return el;
  };
  const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  const MINUS = "−";
  const signed = (v, d = 1) => (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v).toFixed(d);
  const num = (v, d = 1) => (v < 0 ? MINUS : "") + Math.abs(v).toFixed(d);
  const LINE_NAMES = { L1: "Line 1", L2: "Line 2", L3: "Line 3" };
  const WHO = (id) => (id.endsWith("_me") ? "me" : "clone");
  const WHO_LABEL = { me: "Me", clone: "Clone" };

  const FMT = {
    st: (v) => `${signed(v)}<span class="u"> st</span>`,
    st0: (v) => signed(v),
    pm: (v) => `±${v.toFixed(1)} st`,
    int: (v) => String(Math.round(v)),
    db0: (v) => signed(v),
    dbu: (v) => `${signed(v)}<span class="u"> dB</span>`,
    1: (v) => v.toFixed(1),
    dbpk: (v) => `${num(v)} dB`,
    pct: (v) => `${v.toFixed(1)}%`,
    db: (v) => `${num(v)} dB`,
    "db+": (v) => `${signed(v)} dB`,
    2: (v) => v.toFixed(2),
    khz: (v) => `${(v / 1000).toFixed(1)} kHz`,
    lufs: (v) => `${num(v, 0)} LUFS`,
    lu: (v) => `${v.toFixed(2)} LU`,
  };

  let M = null; // measures
  let F = null; // figures

  /* ------------------------------------------------------------------ data */
  const script = (src) => new Promise((ok, no) => {
    const el = document.createElement("script");
    el.src = src; el.onload = ok; el.onerror = no;
    document.head.append(el);
  });

  async function load() {
    try {
      const [m, f] = await Promise.all([
        fetch("data/measures.json").then((r) => r.json()),
        fetch("data/figures.json").then((r) => r.json()),
      ]);
      M = m; F = f;
    } catch (e) {
      // Opened from disk: browsers block fetch() on file://, so read the script twins and
      // play audio through <audio> elements instead of Web Audio.
      Engine.mode = "media";
      try {
        await Promise.all([script("data/measures.js"), script("data/figures.js")]);
        M = window.__MEASURES__; F = window.__FIGURES__;
      } catch (e2) {
        console.error("Could not load data files", e, e2);
        return;
      }
    }
    bindNumbers();
    draftBar();
    sizeDraftOffset();
    hero();
    scores();
    $$(".ab").forEach((el) => new Player(el));
    figurePanels("A");
    figurePanels("B");
    figurePanels("D");
    charts();
    rawTable();
    fadeInCallouts();
    stageLamps();
  }

  function isProvisional(line) { return !!get(M, `lines.${line}.provisional`); }

  function bindNumbers() {
    $$(".m[data-m]").forEach((el) => {
      const v = get(M, el.dataset.m);
      if (typeof v !== "number") { el.textContent = "–"; return; }
      el.innerHTML = (FMT[el.dataset.fmt] || ((x) => String(x)))(v);
      if (el.dataset.prov && isProvisional(el.dataset.prov)) {
        el.insertAdjacentHTML("beforeend", ' <span class="prov" title="Measured on the clone 1 file while clone 2 is re-bounced">provisional</span>');
      }
    });
  }

  function draftBar() {
    const items = [];
    for (const [miss, same] of Object.entries(M.status.missing_takes || {})) {
      items.push(`${miss} is the same audio as ${same}; the missing take needs a re-bounce. Line 3 clone numbers are measured on ${same} and marked provisional.`);
    }
    const ph = $$("mark.placeholder").length;
    if (ph) items.push(`${ph} placeholder${ph > 1 ? "s" : ""} for James to fill.`);
    const all = [...Object.values(F.callouts).filter(Array.isArray).flat(), ...Object.values(F.callouts.strips || {}).flat()];
    const unconf = all.filter((c) => !c.confirmed).length;
    if (unconf) items.push(`${unconf} callout${unconf > 1 ? "s" : ""} not yet confirmed by ear (dashed).`);
    if (!items.length) return;
    const bar = $("#draft");
    $("#draft-items").replaceWith(h("ul", {}, items.map((t) => h("li", {}, t))));
    bar.hidden = false;
  }

  /* ------------------------------------------------------------------ hero */
  function hero() {
    const track = $(".hero-band-track");
    if (!track || !F.hero) return;
    const stops = F.hero.segments.map((sg) => {
      const c = sg.who === "me" ? "#d07c26" : "#1fa3b2";
      return `${c} ${(sg.x0 * 100).toFixed(2)}%, ${c} ${(sg.x1 * 100).toFixed(2)}%`;
    }).join(", ");
    for (let i = 0; i < 2; i++) {
      track.append(h("div", { class: "band" },
        h("img", { src: F.hero.src, alt: "", decoding: "async" }),
        h("div", { class: "tint", style: `background: linear-gradient(90deg, ${stops})` })));
    }
  }

  /* ------------------------------------------------------------------ scores */
  const SEG = ["#4f586a", "#6f7a8c", "#9ea6b2", "#cfccc3", "#f4efe2"];
  function scores() {
    const cells = $$("td[data-score]");
    cells.forEach((td) => {
      const v = +td.dataset.score;
      const m = h("span", { class: "meter", "aria-hidden": "true", style: `--seg:${SEG[v - 1]}` });
      for (let i = 0; i < 5; i++) m.append(h("i", { style: `--i:${i}`, "data-on": i < v ? "1" : null }));
      td.append(m);
    });
    $$("td[data-fit]").forEach((td) => {
      const fit = td.dataset.fit;
      const lamps = h("span", { class: "lamps", "aria-hidden": "true" },
        ["ship", "fix", "hold"].map((k) => h("span", { class: `lamp ${k}${k === fit ? " on" : ""}` }, k.toUpperCase())));
      td.prepend(lamps);
    });
    const light = (root) => $$(".meter i[data-on]", root).forEach((i) => i.classList.add("on"));
    $$(".meter").forEach((m) => m.setAttribute("data-v", ""));
    if (REDUCED || !("IntersectionObserver" in window)) { light(document); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("reveal"); light(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.25 });
    $$(".scorecard").forEach((t) => io.observe(t));
  }

  /* ------------------------------------------------------------------ audio */
  const Engine = {
    ctx: null, buffers: {}, media: {}, active: null, oneshot: null, gen: 0,
    // Web Audio gives sample-accurate A/B. Opened from disk, browsers block fetch(), so the
    // players fall back to plain <audio> elements, which play local files everywhere.
    mode: "webaudio",   // set to "media" in load() when fetch() is blocked
    el(id) {
      if (!this.media[id]) {
        const a = new Audio(`audio/${id}.mp3`);
        a.preload = "auto";
        this.media[id] = a;
      }
      return this.media[id];
    },
    // Call synchronously inside the click/key handler so iOS/Safari unlock the context.
    context() {
      if (!this.ctx) {
        try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* older Safari */ }
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state !== "running") this.ctx.resume().catch(() => {});
      return this.ctx;
    },
    buffer(id) {
      if (!this.buffers[id]) {
        this.context();
        this.buffers[id] = fetch(`audio/${id}.mp3`)
          .then((r) => { if (!r.ok) throw new Error(`audio/${id}.mp3: HTTP ${r.status}`); return r.arrayBuffer(); })
          .then((b) => new Promise((ok, no) => this.ctx.decodeAudioData(b, ok, no)))
          .catch((e) => { delete this.buffers[id]; throw e; });
      }
      return this.buffers[id];
    },
    voice(buf, at) {
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      src.buffer = buf;
      src.connect(g).connect(this.ctx.destination);
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.008);
      src.start(t, Math.min(Math.max(0, at), buf.duration));
      return { src, g, t0: t, at };
    },
    release(v) {
      if (!v) return;
      if (v.media) { v.media.pause(); clearTimeout(v.timer); return; }
      const t = this.ctx.currentTime;
      try {
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setValueAtTime(v.g.gain.value, t);
        v.g.gain.linearRampToValueAtTime(0, t + 0.01);
        v.src.stop(t + 0.012);
      } catch (e) { /* already stopped */ }
    },
    stopAll(except) {
      if (this.active && this.active !== except) this.active.pause();
      this.gen++;
      if (this.oneshot) { this.release(this.oneshot); this.oneshot = null; }
    },
    // Play one window of a take (figure panels, callout chips), with a short fade at each end.
    async playWindow(id, t0, t1) {
      if (this.mode === "media") return this.playWindowMedia(id, t0, t1);
      this.context();
      this.stopAll();
      const gen = this.gen;
      let buf;
      try { buf = await this.buffer(id); } catch (e) {
        console.warn("Web Audio unavailable, using <audio>", e);
        this.mode = "media";
        return this.playWindowMedia(id, t0, t1);
      }
      if (gen !== this.gen) return true;
      const v = this.voice(buf, t0);
      const end = this.ctx.currentTime + Math.max(0.02, t1 - t0);
      v.g.gain.setValueAtTime(1, end - 0.012);
      v.g.gain.linearRampToValueAtTime(0, end);
      v.src.stop(end + 0.005);
      this.oneshot = v;
      return true;
    },
    async playWindowMedia(id, t0, t1) {
      this.stopAll();
      const el = this.el(id);
      try {
        el.currentTime = t0;
        await el.play();
      } catch (e) { console.error(e); return false; }
      const v = { media: el, timer: setTimeout(() => el.pause(), Math.max(20, (t1 - t0) * 1000)) };
      this.oneshot = v;
      return true;
    },
  };

  class Player {
    constructor(root) {
      this.root = root;
      this.line = root.dataset.line;
      this.missing = M.status.missing_takes || {};
      this.takes = $$(".take", root).map((b) => ({ id: b.dataset.take, who: b.dataset.who, btn: b }))
        .filter((t) => {
          if (this.missing[t.id] || !F.strips[t.id]) {
            t.btn.disabled = true;
            t.btn.setAttribute("aria-pressed", "false");
            t.btn.append(h("span", { class: "missing" }, "awaiting re-bounce"));
            return false;
          }
          return true;
        });
      this.cur = this.takes[0];
      this.pos = 0;
      this.playing = false;
      this.voice = null;
      this.gen = 0;          // bumps on every pause/seek/switch so stale async starts are dropped
      this.ticking = false;
      this.build();
      this.wire();
      this.render();
    }

    meta(id) { return F.strips[id]; }

    build() {
      const metas = this.takes.map((t) => this.meta(t.id));
      // Shared timeline, in seconds from each take's speech start.
      this.tmin = -Math.max(...metas.map((m) => m.speech_start_s));
      this.tmax = Math.max(...metas.map((m) => m.duration_s - m.speech_start_s));
      this.span = this.tmax - this.tmin;
      const spec = $("[data-strip]", this.root);
      const yAxis = h("div", { class: "axis-y", style: "height: calc(100% - 52px)", "aria-hidden": "true" },
        [12, 8, 4, 0].map((k) => h("span", { style: `top:${(1 - k / 12) * 100}%` }, `${k}k`)));
      this.wrap = h("div", { class: "spec-img-wrap" });
      this.imgs = {};
      for (const t of this.takes) {
        const m = this.meta(t.id);
        const left = ((-m.speech_start_s - this.tmin) / this.span) * 100;
        const width = (m.duration_s / this.span) * 100;
        const img = h("img", { src: m.src, alt: "", decoding: "async",
          style: `left:${left}%; width:${width}%`, class: t === this.cur ? "" : "off" });
        this.imgs[t.id] = img;
        this.wrap.append(img);
      }
      this.wrap.append(h("div", { class: "speech-start", style: `left:${(-this.tmin / this.span) * 100}%` }));
      this.boxes = h("div", { style: "position:absolute; inset:0" });
      this.wrap.append(this.boxes);
      this.whobar = h("div", { class: "whobar" });
      this.wrap.append(this.whobar);
      this.head = h("div", { class: "playhead" });
      this.wrap.append(this.head);
      const ticks = [];
      for (let t = Math.ceil(this.tmin * 2) / 2; t <= this.tmax + 1e-6; t += 0.5) {
        const x = ((t - this.tmin) / this.span) * 100;
        if (x < 2 || x > 97) continue;
        ticks.push(h("span", { style: `left:${x}%` }, Number.isInteger(t) ? `${t}` : t.toFixed(1)));
      }
      const xAxis = h("div", { class: "axis-x", "aria-hidden": "true" }, ticks);
      spec.append(yAxis, this.wrap, xAxis, h("span", { class: "axis-unit", "aria-hidden": "true" }, "s from first word · kHz"));
      spec.setAttribute("role", "img");
      spec.setAttribute("aria-label", `Spectrogram of the selected take, 0 to 12 kHz. ${this.takes.map((t) => t.btn.textContent).join(", ")} share one time axis aligned on the first word. Click or tap to move the playhead; arrow keys step half a second.`);

      // Callouts for this line
      const list = $(`[data-callouts="${this.line}"]`, this.root);
      this.callouts = (F.callouts.strips[this.line] || []).filter((c) => this.takes.some((t) => t.id === c.file));
      this.callouts.forEach((c) => {
        const m = this.meta(c.file);
        const x0 = ((c.t[0] - m.speech_start_s - this.tmin) / this.span) * 100;
        const x1 = ((c.t[1] - m.speech_start_s - this.tmin) / this.span) * 100;
        const y0 = (1 - c.f[1] / 12000) * 100, y1 = (1 - c.f[0] / 12000) * 100;
        c.box = h("div", { class: `co-box${c.confirmed ? "" : " unconfirmed"}`,
          style: `left:${x0}%; width:${x1 - x0}%; top:${y0}%; height:${y1 - y0}%` },
          h("span", { class: "co-tag" }, c.id));
        this.boxes.append(c.box);
        const chip = h("button", { type: "button", class: "co-chip",
          "aria-label": `${c.label}, ${WHO_LABEL[WHO(c.file)]}, ${c.t[0].toFixed(2)} to ${c.t[1].toFixed(2)} seconds${c.confirmed ? "" : ", not yet confirmed"}. Plays from just before.` },
          h("span", { class: "co-id" }, c.id), h("span", { class: `co-who who-${WHO(c.file)}` }),
          `${c.label} · ${c.t[0].toFixed(2)}–${c.t[1].toFixed(2)} s`,
          c.confirmed ? null : h("span", { class: "co-state" }, "unconfirmed"));
        ["mouseenter", "focus"].forEach((ev) => chip.addEventListener(ev, () => c.box.classList.add("hot")));
        ["mouseleave", "blur"].forEach((ev) => chip.addEventListener(ev, () => c.box.classList.remove("hot")));
        chip.addEventListener("click", () => {
          flashBox(c.box);
          Engine.context();
          const t = this.takes.find((x) => x.id === c.file);
          if (t && t !== this.cur) this.select(t, false);
          this.seek(Math.max(0, c.t[0] - 0.3));
          if (!this.playing) this.play();
        });
        c.chip = chip;
        list.append(h("li", {}, chip));
      });
      if (this.callouts.length) list.before(h("p", { class: "cue mono" }, "▸ tap a marker to hear that moment"));
    }

    wire() {
      $(".ab-play", this.root).addEventListener("click", () => this.toggle());
      this.takes.forEach((t) => t.btn.addEventListener("click", () => { Engine.context(); this.select(t, true); }));
      // Seek on a tap or click, not on a swipe (the strip scrolls sideways on phones).
      let down = null;
      this.wrap.addEventListener("pointerdown", (e) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
      this.wrap.addEventListener("pointercancel", () => { down = null; });
      this.wrap.addEventListener("pointerup", (e) => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
        down = null;
        const r = this.wrap.getBoundingClientRect();
        const rel = this.tmin + ((e.clientX - r.left) / r.width) * this.span;
        this.seek(rel + this.meta(this.cur.id).speech_start_s);
      });
      this.root.addEventListener("keydown", (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const onControl = !!e.target.closest("button, a, details, summary, input");
        if (e.code === "Space" || e.key === " ") {
          if (onControl) return;          // let buttons activate with Space
          e.preventDefault();
          this.toggle();
        } else if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          Engine.context();
          const i = this.takes.indexOf(this.cur);
          this.select(this.takes[(i + 1) % this.takes.length], true);
        } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          if (onControl) return;
          e.preventDefault();
          this.seek(this.now() + (e.key === "ArrowRight" ? 0.5 : -0.5));
        }
      });
    }

    duration() { return this.meta(this.cur.id).duration_s; }

    now() {
      if (!this.playing || !this.voice) return this.pos;
      if (this.voice.media) return this.voice.media.currentTime;
      return this.voice.at + (Engine.ctx.currentTime - this.voice.t0);
    }

    setUI(playing) {
      this.root.classList.toggle("playing", playing);
      $(".ab-play", this.root).setAttribute("aria-label", playing ? "Pause" : "Play");
    }

    // Start (or restart) the current take at this.pos. Any older pending start is dropped.
    async start() {
      const gen = ++this.gen;
      Engine.release(this.voice);
      this.voice = null;
      if (Engine.mode === "media") return this.startMedia(gen);
      let buf;
      try { buf = await Engine.buffer(this.cur.id); } catch (e) {
        if (gen !== this.gen) { console.warn(e); return; }
        console.warn("Web Audio unavailable, using <audio>", e);
        Engine.mode = "media";
        return this.startMedia(gen);
      }
      if (gen !== this.gen || !this.playing) return;
      this.voice = Engine.voice(buf, this.pos);
      this.startTicking();
    }

    async startMedia(gen) {
      const el = Engine.el(this.cur.id);
      try {
        el.currentTime = this.pos;
        await el.play();
      } catch (e) {
        if (gen === this.gen) this.fail(e);
        return;
      }
      if (gen !== this.gen || !this.playing) { el.pause(); return; }
      this.voice = { media: el };
      this.startTicking();
    }

    startTicking() {
      if (!this.ticking) { this.ticking = true; requestAnimationFrame(() => this.tick()); }
    }

    play() {
      if (Engine.mode === "webaudio") Engine.context();
      Engine.stopAll(this);
      Engine.active = this;
      this.playing = true;
      this.setUI(true);
      if (this.pos >= this.duration() - 0.02) this.pos = 0;
      // Preload every take for an instant A/B switch.
      this.takes.forEach((t) => (Engine.mode === "media" ? Engine.el(t.id) : Engine.buffer(t.id).catch(() => {})));
      this.start();
    }

    pause() {
      this.pos = this.now();
      this.playing = false;
      this.gen++;
      Engine.release(this.voice);
      this.voice = null;
      this.setUI(false);
      this.render();
    }

    fail(e) {
      console.error(e);
      this.pause();
      $(".ab-time", this.root).textContent = "Audio could not load";
    }

    toggle() { this.playing ? this.pause() : this.play(); }

    select(t, keepPlaying) {
      if (t === this.cur) return;
      const from = this.meta(this.cur.id), to = this.meta(t.id);
      const next = Math.min(Math.max(0, this.now() - from.speech_start_s + to.speech_start_s), to.duration_s);
      this.cur = t;
      this.pos = next;
      this.takes.forEach((x) => x.btn.setAttribute("aria-pressed", String(x === t)));
      Object.entries(this.imgs).forEach(([id, img]) => img.classList.toggle("off", id !== t.id));
      if (this.playing && keepPlaying) this.start();
      else if (this.playing) this.pause();
      this.render();
    }

    seek(t) {
      this.pos = Math.min(Math.max(0, t), this.duration());
      if (this.playing) this.start();
      this.render();
    }

    tick() {
      if (!this.playing) { this.ticking = false; return; }
      const p = this.now();
      if (p >= this.duration() - 0.005 || (this.voice && this.voice.media && this.voice.media.ended)) {
        this.pause();
        this.pos = 0;
        this.render();
        this.ticking = false;
        return;
      }
      this.render(p);
      requestAnimationFrame(() => this.tick());
    }

    render(p = this.pos) {
      const m = this.meta(this.cur.id);
      const x = ((p - m.speech_start_s - this.tmin) / this.span) * 100;
      this.head.style.left = `${x}%`;
      $(".ab-time", this.root).textContent = `${p.toFixed(2)} s`;
      this.whobar.style.background = this.cur.who === "me" ? "var(--me)" : "var(--clone)";
      this.callouts.forEach((c) => { c.box.style.display = c.file === this.cur.id ? "" : "none"; });
    }
  }

  function flashBox(box) {
    if (!box) return;
    const r = box.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight) box.closest(".spec, .ab").scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
    box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash");
    setTimeout(() => box.classList.remove("flash"), 1800);
  }

  function audioFailNote(btn) {
    const fig = btn.closest(".fig");
    let note = $(".audio-note", fig);
    if (!note) { note = h("p", { class: "audio-note mono", role: "status" }); $(".fig-head", fig).after(note); }
    note.textContent = "Audio could not load.";
  }

  // Keep anchor targets and focused controls clear of the sticky draft bar.
  function sizeDraftOffset() {
    const bar = $("#draft"), flow = $(".flow");
    const set = () => {
      const pinned = !bar.hidden && getComputedStyle(bar).position === "sticky";
      document.documentElement.style.setProperty("--draft-h", pinned ? `${bar.offsetHeight}px` : "0px");
      if (flow) document.documentElement.style.setProperty("--flow-h", `${flow.offsetHeight}px`);
    };
    set();
    window.addEventListener("resize", set);
  }

  /* ------------------------------------------------------------------ figure panels (A, B) */
  const LOG_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 4000, 8000];
  const kfmt = (f) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

  function figurePanels(key) {
    const fig = F.figures[key];
    const root = $(`#fig${key}`);
    if (!fig || !root) return;
    const box = $("[data-panels]", root);
    const yOf = (f) => fig.scale === "log"
      ? (Math.log(fig.fmax_hz) - Math.log(f)) / (Math.log(fig.fmax_hz) - Math.log(fig.fmin_hz))
      : 1 - (f - fig.fmin_hz) / (fig.fmax_hz - fig.fmin_hz);
    const yTicks = fig.scale === "log" ? LOG_TICKS.filter((f) => f >= fig.fmin_hz && f <= fig.fmax_hz)
      : (fig.fmax_hz <= 6000 ? [0, 1000, 2000, 3000, 4000, 5000, 6000] : [0, 2000, 4000, 6000, 8000, 10000, 12000]);
    const tickStep = fig.span_s <= 0.6 ? 0.1 : 0.2;
    if (key === "B" && fig.provisional) {
      $(".fig-head", root).after(h("span", { class: "prov-flag" }, `Provisional: the clone panel is the ${fig.panels.clone.file} file. Clone 2 (the keeper) is awaiting a re-bounce.`));
    }
    const callouts = F.callouts[key] || [];
    const list = $(`[data-callouts="${key}"]`, root);
    // Figures 1 and 3 have one pair of panels; figure 2 has a pair per word.
    const groups = fig.words
      ? Object.entries(fig.words).map(([word, g]) => {
          const sub = h("div", { class: "pair pair-side" });
          box.append(h("div", { class: "word-group" }, h("div", { class: "word-head" }, `"${word}"`), sub));
          return { word, panels: g.panels, into: sub };
        })
      : [{ word: null, panels: fig.panels, into: box }];
    for (const { word, panels, into } of groups) for (const who of ["me", "clone"]) {
      const p = panels[who];
      const span = p.t1_s - p.t0_s;
      const wrap = h("div", { class: "spec-img-wrap" },
        h("img", { src: p.src, alt: "", decoding: "async" }),
        h("div", { class: "whobar", style: `background: var(--${who})` }));
      // Where the analysis window changes (figure A): marked, so the seam is not read as sound.
      if (fig.fsplit_hz) {
        wrap.append(h("div", { class: "fsplit", style: `top:${yOf(fig.fsplit_hz) * 100}%` },
          who === "me" ? h("span", {}, `below ${fig.fsplit_hz} Hz: longer window`) : null));
      }
      // Past the end of the file: marked, not drawn as silence.
      if (p.file_end_s) {
        const x = ((p.file_end_s - p.t0_s) / span) * 100;
        wrap.append(h("div", { class: "file-end", style: `left:${x}%` }, h("span", {}, "file ends")));
      }
      // F0 contour (figure A)
      if (p.f0) {
        const svg = s("svg", { class: "contour", viewBox: "0 0 1000 1000", preserveAspectRatio: "none", "aria-hidden": "true" });
        let d = "", pen = false;
        p.f0.t_s.forEach((t, i) => {
          const hz = p.f0.hz[i];
          if (hz == null || hz < fig.fmin_hz || hz > fig.fmax_hz) { pen = false; return; }
          const x = (t / span) * 1000, y = yOf(hz) * 1000;
          d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
          pen = true;
        });
        // Light outline, dark core: readable over both the warm and the cool spectrogram.
        svg.append(s("path", { d, stroke: "#f4efe2", "stroke-width": "5", "vector-effect": "non-scaling-stroke", fill: "none", opacity: "0.9" }));
        svg.append(s("path", { d, stroke: "#0b0f17", "stroke-width": "2", "vector-effect": "non-scaling-stroke", fill: "none" }));
        wrap.append(svg);
      }
      callouts.filter((c) => c.file === p.file && (!c.word || c.word === word)).forEach((c) => {
        const x0 = ((c.t[0] - p.t0_s) / span) * 100, x1 = ((c.t[1] - p.t0_s) / span) * 100;
        const y0 = yOf(c.f[1]) * 100, y1 = yOf(c.f[0]) * 100;
        c.box = h("div", { class: `co-box${c.confirmed ? "" : " unconfirmed"}`,
          style: `left:${x0}%; width:${x1 - x0}%; top:${y0}%; height:${y1 - y0}%` }, h("span", { class: "co-tag" }, c.id));
        wrap.append(c.box);
      });
      const yAxis = h("div", { class: "axis-y", style: "height: calc(100% - 52px)", "aria-hidden": "true" },
        yTicks.map((f) => h("span", { style: `top:${yOf(f) * 100}%` }, kfmt(f))));
      const ticks = [];
      for (let t = 0; t <= span - fig.pre_s + 1e-6; t += tickStep) {
        const x = ((t + fig.pre_s) / span) * 100;
        if (x > 97) continue;
        ticks.push(h("span", { style: `left:${x}%` }, t.toFixed(1)));
      }
      const unit = key === "B" ? "s from S onset · Hz" : "s from word onset · Hz";
      const spec = h("div", { class: "spec", role: "img", "aria-label": `Spectrogram, ${WHO_LABEL[who].toLowerCase()} (${p.file})` },
        yAxis, wrap, h("div", { class: "axis-x", "aria-hidden": "true" }, ticks), h("span", { class: "axis-unit", "aria-hidden": "true" }, unit));
      const playBtn = h("button", { type: "button", class: "panel-play",
        "aria-label": `Play this window, ${WHO_LABEL[who]}` }, "▶ play window");
      playBtn.addEventListener("click", async () => {
        const ok = await Engine.playWindow(p.file, Math.max(0, p.t0_s), Math.min(p.t1_s, p.file_end_s || p.t1_s));
        if (!ok) audioFailNote(playBtn);
      });
      into.append(h("div", { class: "panel" },
        h("div", { class: "panel-head" }, h("span", { class: `sw who-${who}` }), WHO_LABEL[who], h("span", { class: "file" }, p.file), playBtn),
        spec));
    }
    callouts.forEach((c) => {
      if (!c.box) return;
      const chip = h("button", { type: "button", class: "co-chip",
        "aria-label": `${c.label}, ${WHO_LABEL[WHO(c.file)]}${c.confirmed ? "" : ", not yet confirmed"}. Plays this moment.` },
        h("span", { class: "co-id" }, c.id), h("span", { class: `co-who who-${WHO(c.file)}` }), c.label,
        c.confirmed ? null : h("span", { class: "co-state" }, "unconfirmed"));
      ["mouseenter", "focus"].forEach((ev) => chip.addEventListener(ev, () => c.box.classList.add("hot")));
      ["mouseleave", "blur"].forEach((ev) => chip.addEventListener(ev, () => c.box.classList.remove("hot")));
      chip.addEventListener("click", async () => {
        flashBox(c.box);
        if (!(await Engine.playWindow(c.file, Math.max(0, c.t[0] - 0.15), c.t[1] + 0.15))) audioFailNote(chip);
      });
      list.append(h("li", {}, chip));
    });
    if (list.children.length) list.before(h("p", { class: "cue mono" }, "▸ tap a marker to hear that moment"));
    // A plain-language description of the finding, with numbers from measures.json,
    // read by screen readers alongside the panels.
    let desc;
    if (key === "A") {
      const L = M.lines.L1, ph = L.phrases.Hozier;
      const lo = L.low_end, sb = L.sub_f0;
      desc = `Spectrograms of "Hozier", me above the clone, 20 Hz to 8 kHz. Median pitch on the word: ${ph.f0_me.median_hz} Hz for me, ${ph.f0_clone.median_hz} Hz for the clone. ` +
        `The clone's pitch dips twice across the word; mine falls steadily and dips once into the "-er". In the low end of the voice, 80 to 300 Hz, the clone sits ${signed(lo.clone_minus_me_word_db)} dB against me across the word and ${signed(lo.clone_minus_me_er_db)} dB on the "-er". ` +
        `Below the fundamental, my level moves ${sb.me.swing_p10_p90_db} dB across the word, mostly room and the fry on the "-er"; the clone's moves ${sb.clone.swing_p10_p90_db} dB.`;
    } else if (key === "D") {
      const U = M.lines.L2.upper_formant.words;
      desc = `Spectrograms of "Get" and "then", me and the clone, 0 to 6 kHz. Measured against each take's own 0.3 to 1 kHz level, the clone's 3 to 4 kHz region sits ${signed(U.Get.clone_minus_me_db)} dB above mine on "Get" and ${signed(U.then.clone_minus_me_db)} dB on "then".`;
    } else {
      const S = M.lines.L3.s_in_so;
      desc = `Spectrograms of the S in "So", me and the clone, 0 to 12 kHz. My S is broad noise, flatness ${S.me.flatness_2_12k}; the clone's has a narrow streak near ${(S.clone.peak_hz / 1000).toFixed(1)} kHz, flatness ${S.clone.flatness_2_12k}, and sits ${signed(S.clone_hotter_db)} dB hotter against its vowel.`;
    }
    const d = h("p", { class: "sr-only", id: `fig${key}-desc` }, desc);
    root.append(d);
    root.setAttribute("aria-describedby", d.id);
  }

  /* ------------------------------------------------------------------ charts */
  function tipFor(container) {
    let tip = $(".tip", container);
    if (!tip) { tip = h("div", { class: "tip", hidden: true }); container.append(tip); }
    return tip;
  }
  // Position a tooltip at a fraction of the chart's width/height, kept inside the chart.
  function placeTip(tip, container, fx, fy) {
    tip.hidden = false;
    const cw = container.clientWidth, tw = tip.offsetWidth;
    const cx = Math.min(Math.max(fx * cw, tw / 2 + 4), cw - tw / 2 - 4);
    tip.style.left = `${cx}px`;
    tip.style.top = `${fy * 100}%`;
  }
  // Keep an SVG label inside [lo, hi]: start-anchored at xs if it fits, else end-anchored at xe,
  // else split onto two lines at the last space.
  function fitLabel(t, xs, xe, lo, hi, minY = null, belowY = null) {
    const len = t.getComputedTextLength();
    if (xs + len <= hi) return;
    const xEnd = Math.min(xe, hi);
    if (xEnd - len >= lo) { t.setAttribute("text-anchor", "end"); t.setAttribute("x", xEnd); return; }
    // Two lines: phrase name, then the value.
    const full = t.textContent;
    let cut = full.indexOf(": ");
    if (cut < 0) cut = full.lastIndexOf(" ");
    const parts = [full.slice(0, cut + (full[cut] === ":" ? 1 : 0)), full.slice(cut + (full[cut] === ":" ? 2 : 1))];
    let y0 = +t.getAttribute("y") - 14;
    if (minY != null && y0 - 10 < minY && belowY != null) y0 = belowY;   // no room above: go below the mark
    t.textContent = "";
    t.removeAttribute("text-anchor");
    const spans = parts.map((part, i) => { const ts = s("tspan", { x: xs, y: y0 + i * 14 }); ts.textContent = part; t.append(ts); return ts; });
    spans.forEach((ts) => {
      const l = ts.getComputedTextLength();
      ts.setAttribute("x", Math.max(lo, Math.min(xs, hi - l)));
    });
  }

  const niceTicks = (lo, hi, step) => { const t = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(6)); return t; };

  // Phrases whose pitch the page reports (the others are word windows for other findings).
  // "So" is left out: my read falls into vocal fry that pYIN tracks near 63 Hz while the
  // clone's creak reads as unvoiced, so the two medians are not comparable (see measures.json).
  const PITCH_PHRASES = { L1: ["Hozier"], L3: ["what are you in the mood for"] };

  function chartC(el) {
    const lines = Object.keys(M.contours);
    const W = el.clientWidth || 700;
    const padL = 44, padR = 16, rowH = 150, gap = 26, top = 8;
    const H = top + lines.length * (rowH + gap) + 16;
    let tmax = 0, ymin = 0, ymax = 0;
    lines.forEach((L) => ["me", "clone"].forEach((w) => {
      const c = M.contours[L][w];
      c.t_s.forEach((t, i) => { if (c.st[i] != null) { tmax = Math.max(tmax, t); ymin = Math.min(ymin, c.st[i]); ymax = Math.max(ymax, c.st[i]); } });
    }));
    ymin = Math.floor(ymin / 6) * 6; ymax = Math.ceil(ymax / 6) * 6; tmax = Math.ceil(tmax * 2) / 2;
    const x = (t) => padL + (t / tmax) * (W - padL - padR);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const rows = [], labels = [];
    lines.forEach((L, k) => {
      const y0 = top + k * (rowH + gap) + 18;
      const ih = rowH - 18;
      const y = (v) => y0 + (1 - (v - ymin) / (ymax - ymin)) * ih;
      const g = s("g");
      const grid = s("g", { class: "grid" });
      niceTicks(ymin, ymax, 6).forEach((v) => {
        grid.append(s("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: v === 0 ? "zero" : null }));
        const t = s("text", { x: padL - 6, y: y(v) + 4, "text-anchor": "end" }); t.textContent = v === 0 ? "0" : signed(v, 0); g.append(t);
      });
      g.prepend(grid);
      const lab = s("text", { x: padL, y: y0 - 6, class: "row-label" });
      lab.textContent = `${LINE_NAMES[L]}${M.lines[L].provisional ? " (provisional)" : ""}`;
      if (W >= 560) {
        const unitY = s("text", { x: padL + 70, y: y0 - 6, class: "lab" }); unitY.textContent = "semitones vs. my median";
        g.append(unitY);
      }
      g.append(lab);
      const diff = s("text", { x: W - padR, y: y0 - 6, "text-anchor": "end", class: "val" });
      diff.textContent = `clone median ${signed(M.lines[L].f0_diff_st)} st`;
      g.append(diff);
      for (const w of ["me", "clone"]) {
        const c = M.contours[L][w];
        let d = "", pen = false;
        c.t_s.forEach((t, i) => {
          const v = c.st[i];
          if (v == null || t < 0) { pen = false; return; }
          d += `${pen ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
        });
        g.append(s("path", { d, class: `s-${w}`, fill: "none", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      }
      // Phrase medians that passed the octave check
      const medG = s("g");
      g.insertBefore(medG, g.querySelector("path"));
      const Lm = M.lines[L];
      const ref = Lm.f0_median_me_hz;
      Object.entries(Lm.phrases).forEach(([name, ph]) => {
        if (!(PITCH_PHRASES[L] || []).includes(name) || !ph.f0_me || !ph.f0_clone) return;
        if (ph.octave_check_me !== "pass" || ph.octave_check_clone !== "pass") return;
        // Bars sit under the contours; when the two medians are within a few pixels they are
        // nudged apart so neither hides the other.
        const bars = ["me", "clone"].map((w) => {
          const win = ph[`window_${w}_s`], st0 = M.files[w === "me" ? Lm.me : Lm.clone].speech_start_s;
          return { w, x1: x(win[0] - st0), x2: x(win[1] - st0), yy: y(12 * Math.log2(ph[`f0_${w}`].median_hz / ref)) };
        });
        if (Math.abs(bars[0].yy - bars[1].yy) < 6) { bars[0].yy -= 3; bars[1].yy += 3; }
        bars.forEach((b) => medG.append(s("line", { x1: b.x1, x2: b.x2, y1: b.yy, y2: b.yy, class: "halo", "stroke-linecap": "round" })));
        bars.forEach((b) => medG.append(s("line", { x1: b.x1, x2: b.x2, y1: b.yy, y2: b.yy, class: `s-${b.w} median-bar`, "stroke-linecap": "round" })));
        const cb = bars[1];
        const t = s("text", { x: cb.x1, y: cb.yy - 9, class: "val" });
        t.textContent = `"${name}": clone ${signed(ph.f0_diff_st)} st`;
        g.append(t);
        labels.push([t, cb.x1, cb.x2, y0 + 4, cb.yy + 22]);
      });
      svg.append(g);
      rows.push({ L, y0, ih, y });
    });
    // x axis at bottom
    const xa = s("g");
    niceTicks(0, tmax, tmax > 4 ? 1 : 0.5).forEach((t) => {
      const tx = s("text", { x: x(t), y: H - 22, "text-anchor": "middle" }); tx.textContent = t; xa.append(tx);
    });
    const unit = s("text", { x: W - padR, y: H - 2, "text-anchor": "end" }); unit.textContent = W >= 560 ? "s from speech start" : "s · semitones vs. my median";
    xa.append(unit);
    svg.append(xa);
    // crosshair
    const xh = s("line", { class: "xhair", y1: 0, y2: H - 34, opacity: 0 });
    svg.append(xh);
    el.replaceChildren(svg);
    labels.forEach(([t, xs, xe, minY, belowY]) => fitLabel(t, xs, xe, padL, W - padR, minY, belowY));
    el.setAttribute("aria-label", "Pitch contours, me vs. the clone, in semitones relative to my median. " +
      lines.map((L) => `${LINE_NAMES[L]}: clone median ${signed(M.lines[L].f0_diff_st)} semitones`).join("; ") +
      `. On "what are you in the mood for" the clone is ${signed(M.lines.L3.phrases["what are you in the mood for"].f0_diff_st)} semitones above my read.`);
    const tip = tipFor(el);
    const near = (c, t) => {
      let bi = -1, bd = 1e9;
      c.t_s.forEach((tt, i) => { const dd = Math.abs(tt - t); if (dd < bd) { bd = dd; bi = i; } });
      return bd < 0.02 ? c.st[bi] : null;
    };
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
      const row = rows.find((rw) => py >= rw.y0 - 18 && py <= rw.y0 + rw.ih + 8);
      if (!row || px < padL || px > W - padR) { tip.hidden = true; xh.setAttribute("opacity", 0); return; }
      const t = ((px - padL) / (W - padL - padR)) * tmax;
      xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("opacity", 1);
      const vm = near(M.contours[row.L].me, t), vc = near(M.contours[row.L].clone, t);
      tip.innerHTML = `${LINE_NAMES[row.L]} · ${t.toFixed(2)} s<br><span class="tag-me">me</span> ${vm == null ? "no pitch" : signed(vm) + " st"}<br><span class="tag-clone">clone</span> ${vc == null ? "no pitch" : signed(vc) + " st"}`;
      placeTip(tip, el, px / W, row.y0 / H);
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; xh.setAttribute("opacity", 0); });
  }

  // Shared line chart over time for figure 1's two band charts.
  function bandOverTime(el, series, opts) {
    const W = el.clientWidth || 600;
    const padL = 40, padR = 12, top = 10, H = 170, bot = 24;
    let tmax = 0, lo = 1e9, hi = -1e9;
    ["me", "clone"].forEach((w) => series[w].t_s.forEach((t, i) => {
      tmax = Math.max(tmax, t); lo = Math.min(lo, series[w].db[i]); hi = Math.max(hi, series[w].db[i]);
    }));
    if (opts.floor != null) lo = Math.min(lo, opts.floor - 2);
    lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10;
    if (opts.minLo != null) lo = Math.max(lo, opts.minLo);
    const x = (t) => padL + (t / tmax) * (W - padL - padR);
    const y = (v) => top + (1 - (Math.max(v, lo) - lo) / (hi - lo)) * (H - top - bot);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const grid = s("g", { class: "grid" });
    niceTicks(lo, hi, 10).forEach((v) => {
      grid.append(s("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: opts.zero && v === 0 ? "zero" : null }));
      const t = s("text", { x: padL - 6, y: y(v) + 4, "text-anchor": "end" });
      t.textContent = opts.signedTicks ? (v === 0 ? "0" : signed(v, 0)) : num(v, 0);
      svg.append(t);
    });
    svg.prepend(grid);
    niceTicks(0, tmax, 0.1).forEach((t) => { const tx = s("text", { x: x(t), y: H - 6, "text-anchor": "middle" }); tx.textContent = t.toFixed(1); svg.append(tx); });
    if (opts.floor != null) svg.append(s("line", { x1: padL, x2: W - padR, y1: y(opts.floor), y2: y(opts.floor), class: "s-me room-ref" }));
    ["me", "clone"].forEach((w) => {
      const sr = series[w];
      const d = sr.t_s.map((t, i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(sr.db[i]).toFixed(1)}`).join("");
      svg.append(s("path", { d, class: `s-${w}`, fill: "none", "stroke-width": 2, "stroke-linejoin": "round" }));
    });
    el.replaceChildren(svg);
    el.append(h("p", { class: "fig-meta mono", style: "margin:4px 0 0" }, opts.unit));
    const tip = tipFor(el);
    const near = (sr, t) => { let bi = 0, bd = 1e9; sr.t_s.forEach((tt, i) => { const dd = Math.abs(tt - t); if (dd < bd) { bd = dd; bi = i; } }); return bd < 0.01 ? sr.db[bi] : null; };
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      if (px < padL || px > W - padR) { tip.hidden = true; return; }
      const t = ((px - padL) / (W - padL - padR)) * tmax;
      const vm = near(series.me, t), vc = near(series.clone, t);
      tip.innerHTML = `${t.toFixed(2)} s<br><span class="tag-me">me</span> ${vm == null ? "–" : num(vm) + " dB"}<br><span class="tag-clone">clone</span> ${vc == null ? "–" : num(vc) + " dB"}`;
      placeTip(tip, el, px / W, top / H + 0.15);
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  }

  function chartSubF0(el) {
    const S = M.lines.L1.sub_f0;
    bandOverTime(el, { me: S.me.series, clone: S.clone.series }, {
      floor: S.me_room_floor_db,
      unit: `s from word onset · dB, ${S.band_hz[0]}–${S.band_hz[1]} Hz band · dashed: my room floor, measured in my pauses`,
    });
    el.setAttribute("aria-label", `Level of the ${S.band_hz[0]} to ${S.band_hz[1]} Hz band under "Hozier". Mine sits at my room floor and rises with the fry on the "-er", moving ${S.me.swing_p10_p90_db} dB; the clone's holds steadier, moving ${S.clone.swing_p10_p90_db} dB.`);
  }

  // The low end of the voice (80-300 Hz) across "Hozier", relative to my average.
  function chartLowEnd(el) {
    const Lw = M.lines.L1.low_end;
    bandOverTime(el, { me: Lw.me.series, clone: Lw.clone.series }, {
      zero: true, signedTicks: true, minLo: -40,
      unit: "s from word onset · dB, 0 = my average across the word (both takes at the same loudness)",
    });
    el.setAttribute("aria-label", `Low end of the voice, 80 to 300 Hz, across "Hozier". The clone sits ${signed(Lw.clone_minus_me_word_db)} dB against me across the word and ${signed(Lw.clone_minus_me_er_db)} dB on the "-er".`);
  }

  // Shared dumbbell chart: one row per item, my dot and the clone's on one axis, the gap at right.
  function dumbbells(el, rows, unitText, opts = {}) {
    const W = el.clientWidth || 500;
    const padL = 10, padR = 78, top = 24, rowH = 40, H = top + rows.length * rowH + 22;
    let lo = 0, hi = -200;
    rows.forEach((r) => { lo = Math.min(lo, r.me, r.clone); hi = Math.max(hi, r.me, r.clone); });
    lo = Math.floor(lo / 5) * 5; hi = Math.ceil(hi / 5) * 5;
    const x = (v) => padL + ((v - lo) / (hi - lo)) * (W - padL - padR);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const grid = s("g", { class: "grid" });
    niceTicks(lo, hi, (hi - lo) > 30 ? 10 : 5).forEach((v) => {
      grid.append(s("line", { x1: x(v), x2: x(v), y1: top - 6, y2: H - 20 }));
      const t = s("text", { x: x(v), y: H - 6, "text-anchor": "middle" }); t.textContent = num(v, 0); svg.append(t);
    });
    svg.append(grid);
    const hd = s("text", { x: W - padR + 6, y: top - 10, class: "lab" }); hd.textContent = opts.diffHead || "clone vs me"; svg.append(hd);
    rows.forEach((r, i) => {
      const y = top + i * rowH + 26;
      const lab = s("text", { x: padL, y: y - 12, class: r.minor ? "lab" : "row-label" }); lab.textContent = r.label; svg.append(lab);
      svg.append(s("line", { x1: x(r.me), x2: x(r.clone), y1: y, y2: y, stroke: "#5b6b80", "stroke-width": 2 }));
      svg.append(s("circle", { cx: x(r.me), cy: y, r: 5, class: "f-me ring" }));
      svg.append(s("circle", { cx: x(r.clone), cy: y, r: 5, class: "f-clone ring" }));
      const d = s("text", { x: W - padR + 6, y: y + 4, class: "val" }); d.textContent = `${signed(r.diff)} dB`; svg.append(d);
    });
    el.replaceChildren(svg);
    el.append(h("p", { class: "fig-meta mono", style: "margin:4px 0 0" }, unitText));
  }

  // Figure 2: energy around the character formants on "Get" and "then".
  function chartUpper(el) {
    const U = M.lines.L2.upper_formant;
    dumbbells(el, Object.entries(U.words).map(([w, v]) => ({ label: `"${w}"`, me: v.me.upper_rel_db, clone: v.clone.upper_rel_db, diff: v.clone_minus_me_db })),
      "dB at 3–4 kHz, relative to each take's own first-formant level (0.3–1 kHz)");
    el.setAttribute("aria-label", `Energy around the upper formants. "Get": the clone is ${signed(U.words.Get.clone_minus_me_db)} dB above me. "then": ${signed(U.words.then.clone_minus_me_db)} dB.`);
  }

  // Formant map rows: one per word (averaged over its voiced frames) and per whole line.
  function fmRows() {
    return M.formant_map.rows.map((r) => ({ ...r, label: r.word === "whole line" ? `${LINE_NAMES[r.line]}, whole line` : `"${r.word}" (${LINE_NAMES[r.line].toLowerCase()})` }));
  }

  // Figure 5, left: where the third and fourth formants sit, me vs. the clone.
  function chartFormantPos(el) {
    const rows = fmRows();
    const W = el.clientWidth || 500;
    const padL = 10, padR = 78, top = 24, rowH = 40, H = top + rows.length * rowH + 22;
    const lo = 2000, hi = 4200;
    const x = (f) => padL + ((f - lo) / (hi - lo)) * (W - padL - padR);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const grid = s("g", { class: "grid" });
    [2000, 2500, 3000, 3500, 4000].forEach((f) => {
      grid.append(s("line", { x1: x(f), x2: x(f), y1: top - 6, y2: H - 20 }));
      const t = s("text", { x: x(f), y: H - 6, "text-anchor": "middle" }); t.textContent = `${f / 1000}k`; svg.append(t);
    });
    svg.append(grid);
    const hd = s("text", { x: W - padR + 6, y: top - 10, class: "lab" }); hd.textContent = "largest gap"; svg.append(hd);
    rows.forEach((r, i) => {
      const y = top + i * rowH + 26;
      const lab = s("text", { x: padL, y: y - 12, class: r.word === "whole line" ? "lab" : "row-label" }); lab.textContent = r.label; svg.append(lab);
      ["F3_hz", "F4_hz"].forEach((k) => {
        const a = r.me[k], b = r.clone[k];
        if (a == null || b == null) return;
        svg.append(s("line", { x1: x(a), x2: x(b), y1: y, y2: y, stroke: "#5b6b80", "stroke-width": 2 }));
        svg.append(s("circle", { cx: x(a), cy: y, r: 5, class: "f-me ring" }));
        svg.append(s("circle", { cx: x(b), cy: y, r: 5, class: "f-clone ring" }));
      });
      const gap = Math.max(Math.abs(r.pct_diff.F3_hz), Math.abs(r.pct_diff.F4_hz));
      const d = s("text", { x: W - padR + 6, y: y + 4, class: "val" }); d.textContent = `${gap.toFixed(1)}%`; svg.append(d);
    });
    el.replaceChildren(svg);
    el.append(h("p", { class: "fig-meta mono", style: "margin:4px 0 0" }, "Hz · left dots: third formant, right dots: fourth · gaps from one estimate setting"));
    const S = M.formant_map.summary;
    el.setAttribute("aria-label", `Third and fourth formant frequencies per word, me vs. the clone. They land close to mine on every word: the largest gap is ${S.upper_formants_gap_range_pct[0]} to ${S.upper_formants_gap_range_pct[1]} percent depending on the estimate settings.`);
  }

  // Figure 5, right: energy around the fourth formant (3-4 kHz).
  function chartFormantLevel(el) {
    dumbbells(el, fmRows().map((r) => ({ label: r.label, me: r.me.upper_rel_db, clone: r.clone.upper_rel_db, diff: r.upper_diff_db, minor: r.word === "whole line" })),
      "dB at 3–4 kHz, relative to each take's own first-formant level");
    const S = M.formant_map.summary;
    el.setAttribute("aria-label", `Energy around the fourth formant, 3 to 4 kHz, per word. The clone runs hotter on ${S.words_clone_hotter} of ${S.words} words, by ${S.upper_diff_min_db} to ${S.upper_diff_max_db} dB.`);
  }

  function chartBspec(el) {
    const S = M.lines.L3.s_in_so;
    const W = el.clientWidth || 380;
    const padL = 40, padR = 12, top = 30, H = 250, bot = 26;
    let lo = 1e9, hi = -1e9;
    ["me", "clone"].forEach((w) => S[w].spectrum.db.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10;
    const x = (f) => padL + ((f - 2000) / 10000) * (W - padL - padR);
    const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bot);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const grid = s("g", { class: "grid" });
    niceTicks(lo, hi, 10).forEach((v) => {
      grid.append(s("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
      const t = s("text", { x: padL - 6, y: y(v) + 4, "text-anchor": "end" }); t.textContent = num(v, 0); svg.append(t);
    });
    [2000, 4000, 6000, 8000, 10000, 12000].forEach((f) => {
      const t = s("text", { x: x(f), y: H - 8, "text-anchor": "middle" }); t.textContent = `${f / 1000}k`; svg.append(t);
    });
    svg.prepend(grid);
    const ul = s("text", { x: padL, y: 12 }); ul.textContent = "dB (Welch average over the S)"; svg.append(ul);
    ["me", "clone"].forEach((w) => {
      const sp = S[w].spectrum;
      const d = sp.freq_hz.map((f, i) => `${i ? "L" : "M"}${x(f).toFixed(1)},${y(sp.db[i]).toFixed(1)}`).join("");
      svg.append(s("path", { d, class: `s-${w}`, fill: "none", "stroke-width": 2, "stroke-linejoin": "round" }));
    });
    // Label the clone's peak
    const pk = S.clone.peak_hz, sp = S.clone.spectrum;
    const i = sp.freq_hz.reduce((b, f, k) => (Math.abs(f - pk) < Math.abs(sp.freq_hz[b] - pk) ? k : b), 0);
    svg.append(s("circle", { cx: x(pk), cy: y(sp.db[i]), r: 5, class: "f-clone ring" }));
    const t = s("text", { x: x(pk) + 10, y: y(sp.db[i]) + 4, class: "val" });
    t.textContent = `clone peak ${(pk / 1000).toFixed(1)} kHz, ${signed(S.clone.peak_prominence_db)} dB`;
    svg.append(t);
    el.replaceChildren(svg);
    fitLabel(t, x(pk) + 10, x(pk) - 10, padL, W - padR);
    el.setAttribute("aria-label", `Averaged spectrum of the S, 2 to 12 kHz. Mine is broad (flatness ${S.me.flatness_2_12k}); the clone's has a narrow peak at ${(pk / 1000).toFixed(1)} kHz, ${signed(S.clone.peak_prominence_db)} dB above its neighbors (flatness ${S.clone.flatness_2_12k}).`);
    const tip = tipFor(el);
    const xh = s("line", { class: "xhair", y1: top, y2: H - bot, opacity: 0 });
    svg.append(xh);
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      if (px < padL || px > W - padR) { tip.hidden = true; xh.setAttribute("opacity", 0); return; }
      const f = 2000 + ((px - padL) / (W - padL - padR)) * 10000;
      const k = Math.round((f - S.me.spectrum.freq_hz[0]) / (S.me.spectrum.freq_hz[1] - S.me.spectrum.freq_hz[0]));
      const kk = Math.min(Math.max(k, 0), S.me.spectrum.db.length - 1);
      xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("opacity", 1);
      tip.innerHTML = `${(S.me.spectrum.freq_hz[kk] / 1000).toFixed(2)} kHz<br><span class="tag-me">me</span> ${num(S.me.spectrum.db[kk])} dB<br><span class="tag-clone">clone</span> ${num(S.clone.spectrum.db[kk])} dB`;
      placeTip(tip, el, px / W, top / H + 0.1);
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; xh.setAttribute("opacity", 0); });
  }

  function table(head, rows) {
    return h("div", { class: "table-scroll", role: "region", tabindex: "0", "aria-label": "Data table" },
      h("table", {}, h("thead", {}, h("tr", {}, head.map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c == null ? "–" : String(c))))))));
  }

  function charts() {
    const draw = () => {
      const c = $('[data-chart="C"]'), e = $('[data-chart="E"]'), b = $('[data-chart="Bspec"]'), sf = $('[data-chart="subF0"]'), up = $('[data-chart="upper"]');
      if (sf) chartSubF0(sf);
      const le = $('[data-chart="lowend"]');
      if (le) chartLowEnd(le);
      if (up) chartUpper(up);
      const fp = $('[data-chart="fpos"]'), fl = $('[data-chart="flevel"]');
      if (fp) chartFormantPos(fp);
      if (fl) chartFormantLevel(fl);
      if (c) chartC(c);
      if (b) chartBspec(b);
    };
    draw();
    let w = window.innerWidth;
    window.addEventListener("resize", () => {
      if (Math.abs(window.innerWidth - w) < 8) return;
      w = window.innerWidth;
      clearTimeout(draw.t); draw.t = setTimeout(draw, 120);
    });

    const rowsC = [];
    for (const [L, Lm] of Object.entries(M.lines)) {
      rowsC.push([LINE_NAMES[L] + (Lm.provisional ? " (provisional)" : ""), "whole line", Lm.f0_median_me_hz, Lm.f0_median_clone_hz, signed(Lm.f0_diff_st),
        `${M.files[Lm.me].f0_harmonic_spacing_hz} / ${M.files[Lm.clone].f0_harmonic_spacing_hz}`, `${Lm.f0_octave_check.me} / ${Lm.f0_octave_check.clone}`]);
      for (const [name, ph] of Object.entries(Lm.phrases)) {
        if (!ph.f0_me || !ph.f0_clone) continue;
        const ok = ph.octave_check_me === "pass" && ph.octave_check_clone === "pass";
        rowsC.push(["", `"${name}"${ph.confirmed ? "" : " (window unconfirmed)"}`,
          ok ? ph.f0_me.median_hz : "withheld", ok ? ph.f0_clone.median_hz : "withheld",
          !ok ? "withheld" : ph.comparable === false ? `not comparable (fry: me ${Math.round(ph.fry_share_me * 100)}%, clone ${Math.round(ph.fry_share_clone * 100)}%)`
            : ph.f0_diff_st != null ? signed(ph.f0_diff_st) : null,
          ph.harmonic_spacing_me_hz + " / " + ph.harmonic_spacing_clone_hz,
          `${ph.octave_check_me} / ${ph.octave_check_clone}`]);
      }
    }
    $('[data-table="C"]').append(table(["Line", "Phrase", "Me (Hz)", "Clone (Hz)", "Clone vs me (st)", "Harmonic spacing me / clone (Hz)", "Octave check"], rowsC));

    $('[data-table="fmap"]').append(table(["Word", "F1 me / clone (Hz)", "F2", "F3", "F4", "3–4 kHz me / clone (dB)", "Clone vs me (dB)"],
      fmRows().map((r) => [r.label, ...["F1_hz", "F2_hz", "F3_hz", "F4_hz"].map((k) => `${r.me[k]} / ${r.clone[k]} (${signed(r.pct_diff[k])}%)`),
        `${num(r.me.upper_rel_db)} / ${num(r.clone.upper_rel_db)}`, signed(r.upper_diff_db)])));

    const U = M.lines.L2.upper_formant;
    $('[data-table="upper"]').append(table(["", "Me: 3–4 kHz vs 0.3–1 kHz (dB)", "Clone (dB)", "Clone above me (dB)", "Word vs its own line: me / clone (dB)"],
      [...Object.entries(U.words).map(([w, v]) => [`"${w}" (line 2)${v.confirmed ? "" : ", window unconfirmed"}`, num(v.me.upper_rel_db), num(v.clone.upper_rel_db),
        signed(v.clone_minus_me_db), `${signed(v.me_word_minus_me_line_db)} / ${signed(v.clone_word_minus_clone_line_db)}`]),
       ...Object.entries(M.lines).map(([L, Lm]) => [`${LINE_NAMES[L]}, whole line`, num(Lm.upper_formant_line.me), num(Lm.upper_formant_line.clone),
        signed(Lm.upper_formant_line.clone_minus_me_db), ""])]));

    const S = M.lines.L3.s_in_so;
    $('[data-table="Bspec"]').append(table(["", "Me", "Clone"], [
      ["File", M.lines.L3.me, M.lines.L3.clone + (M.lines.L3.provisional ? " (provisional)" : "")],
      ["S vs following vowel (dB)", num(S.me.s_minus_vowel_db), num(S.clone.s_minus_vowel_db)],
      ["Spectral flatness 2–12 kHz", S.me.flatness_2_12k, S.clone.flatness_2_12k],
      ["Strongest peak 3–7 kHz (Hz)", S.me.peak_hz, S.clone.peak_hz],
      ["Peak above neighbors (dB)", signed(S.me.peak_prominence_db), signed(S.clone.peak_prominence_db)],
      ["Within 10 dB of the S's maximum (Hz)", S.me.within_10db_of_max_hz.join("–"), S.clone.within_10db_of_max_hz.join("–")],
    ]));
  }

  // Light the stage lamp for the section in the middle of the screen.
  function stageLamps() {
    const links = $$(".flow a");
    if (!links.length || !("IntersectionObserver" in window)) return;
    const nav = $(".flow");
    const light = (id) => links.forEach((a) => {
      const on = a.dataset.stage === id;
      a.classList.toggle("on", on);
      if (on) {
        a.setAttribute("aria-current", "true");
        const l = a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2;
        nav.scrollTo({ left: Math.max(0, l), behavior: REDUCED ? "auto" : "smooth" });
      } else a.removeAttribute("aria-current");
    });
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) light(e.target.id); }),
      { rootMargin: "-45% 0px -50% 0px" });
    links.forEach((a) => { const sec = document.getElementById(a.dataset.stage); if (sec) io.observe(sec); });
  }

  function fadeInCallouts() {
    if (REDUCED || !("IntersectionObserver" in window)) return;
    document.documentElement.classList.add("js-fade");
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("seen"); io.unobserve(e.target); }
    }), { threshold: 0.2 });
    $$(".ab, .fig").forEach((el) => io.observe(el));
  }

  function rawTable() {
    const el = $('[data-table="raw"]');
    if (!el) return;
    el.append(table(["File", "Integrated loudness (LUFS)", "True peak (dBTP)", "Player clip (LUFS)", "Player true peak (dBTP)"],
      Object.entries(M.files).map(([n, f]) => [n, num(f.raw_lufs, 1), num(f.raw_true_peak_dbtp, 1),
        M.player.clips[n] ? num(M.player.clips[n].lufs, 2) : null, M.player.clips[n] ? num(M.player.clips[n].true_peak_dbtp, 1) : null])));
  }

  load();
})();
