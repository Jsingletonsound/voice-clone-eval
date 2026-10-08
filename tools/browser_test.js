// Browser test for the page: players, keyboard, callouts, charts, phone layout.
// Optional dev tool, not needed to view the site:
//   npm install puppeteer-core
//   CHROME="/path/to/chrome" node tools/browser_test.js
//   PAGE_URL="https://jsingletonsound.github.io/voice-clone-eval/" node tools/browser_test.js   (test the live site)
// By default opens index.html from disk with file access allowed, so data and audio load as on a server.
const puppeteer = require("puppeteer-core");
const path = require("path");
const FILE_URL = "file://" + path.resolve(__dirname, "..", "index.html");
const URL = process.env.PAGE_URL || FILE_URL;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
// Count live AudioBufferSourceNodes so overlapping playback shows up as a number.
const LIVE = `(() => { window.__live = 0; const st = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { window.__live++; this.addEventListener("ended", () => window.__live--); return st.apply(this, a); }; })();`;
const PHONE = { viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };

async function open(page) {
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await sleep(600);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
  await page.evaluateOnNewDocument(LIVE);
  await page.setViewport({ width: 1280, height: 900 });
  await open(page);
  const live = () => page.evaluate(() => window.__live);
  const M = await page.evaluate(() => fetch("data/measures.json").then((r) => r.json()));

  // ---- data and structure
  const s1 = await page.evaluate(() => ({
    dashes: [...document.querySelectorAll(".m")].filter((e) => e.textContent.trim() === "–").map((e) => e.dataset.m),
    disabled: [...document.querySelectorAll(".take")].filter((b) => b.disabled).map((b) => b.dataset.take),
    takes: document.querySelectorAll(".take").length,
    strips: [...document.querySelectorAll(".ab .spec-img-wrap img")].every((i) => i.complete && i.naturalWidth > 0),
    charts: [...document.querySelectorAll(".chart svg")].map((s) => s.querySelectorAll("path, line").length),
    panels: document.querySelectorAll(".panel").length,
    tables: [...document.querySelectorAll("[data-table]")].every((t) => t.querySelectorAll("tr").length > 1),
  }));
  check("every measurement binding resolves", s1.dashes.length === 0, s1.dashes.join(", "));
  check("all 7 takes enabled", s1.takes === 7 && s1.disabled.length === 0, JSON.stringify(s1.disabled));
  check("strip images loaded", s1.strips);
  check("charts drawn (low end, bass band, upper formant, pitch, formant map ×2, S spectrum)", s1.charts.length === 7 && s1.charts.every((n) => n > 1), JSON.stringify(s1.charts));
  check("figure panels: 2 + 4 + 2 = 8", s1.panels === 8, `${s1.panels}`);
  check("data tables filled", s1.tables);

  // ---- meters
  await page.evaluate(() => document.querySelector("#line1 .scorecard").scrollIntoView({ block: "center" }));
  await sleep(900);
  const lit = await page.evaluate(() => [document.querySelectorAll("#line1 .meter i.on").length,
    [...document.querySelectorAll("#line1 td[data-score]")].reduce((a, td) => a + +td.dataset.score, 0)]);
  check("line 1 meters lit = sum of scores", lit[0] === lit[1], `${lit[0]} of ${lit[1]}`);

  // ---- A/B player
  const L1 = "#line1 .ab";
  await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), L1);
  await page.click(`${L1} .ab-play`);
  await sleep(1500);
  const p1 = await page.evaluate((sel) => ({ playing: document.querySelector(sel).classList.contains("playing"),
    time: parseFloat(document.querySelector(sel + " .ab-time").textContent) }), L1);
  check("line 1 plays and the playhead moves", p1.playing && p1.time > 0.8 && p1.time < 2.5, JSON.stringify(p1));
  await page.focus(L1);
  const before = await page.evaluate((sel) => parseFloat(document.querySelector(sel + " .ab-time").textContent), L1);
  await page.keyboard.press("b");
  await sleep(120);
  const p2 = await page.evaluate((sel) => ({ pressed: [...document.querySelectorAll(sel + " .take")].map((b) => b.getAttribute("aria-pressed")).join(),
    playing: document.querySelector(sel).classList.contains("playing"), time: parseFloat(document.querySelector(sel + " .ab-time").textContent) }), L1);
  const expected = before - M.files.L1_me.speech_start_s + M.files.L1_clone.speech_start_s;
  check("B switches to the clone and keeps playing", p2.pressed === "false,true" && p2.playing, JSON.stringify(p2));
  check("the switch lands at the aligned position", Math.abs(p2.time - expected) < 0.25, `${before} → ${p2.time}, expected ≈${expected.toFixed(2)}`);
  const ar0 = await page.evaluate((sel) => parseFloat(document.querySelector(sel + " .ab-time").textContent), L1);
  await page.keyboard.press("ArrowRight");
  await sleep(60);
  const ar1 = await page.evaluate((sel) => parseFloat(document.querySelector(sel + " .ab-time").textContent), L1);
  check("ArrowRight while playing jumps about 0.5 s ahead", ar1 - ar0 > 0.35 && ar1 - ar0 < 0.8, `${ar0} → ${ar1}`);
  await page.keyboard.press("Space");
  await sleep(200);
  const t1 = await page.evaluate((sel) => [document.querySelector(sel).classList.contains("playing"), document.querySelector(sel + " .ab-time").textContent], L1);
  await sleep(400);
  const t2 = await page.evaluate((sel) => document.querySelector(sel + " .ab-time").textContent, L1);
  check("Space pauses and the time holds", !t1[0] && t1[1] === t2, `${t1} / ${t2}`);
  check("pause leaves no live voice", (await live()) === 0, `live=${await live()}`);
  await page.evaluate((sel) => {
    const w = document.querySelector(sel + " .spec-img-wrap"); const r = w.getBoundingClientRect();
    const o = { clientX: r.left + r.width * 0.93, clientY: r.top + 10, bubbles: true, button: 0 };
    w.dispatchEvent(new PointerEvent("pointerdown", o)); w.dispatchEvent(new PointerEvent("pointerup", o));
  }, L1);
  await page.keyboard.press("Space");
  await sleep(1600);
  const end = await page.evaluate((sel) => [document.querySelector(sel).classList.contains("playing"), document.querySelector(sel + " .ab-time").textContent], L1);
  check("tap seeks; playback stops at the end and resets", !end[0] && end[1] === "0.00 s", JSON.stringify(end));

  // ---- no overlapping voices
  await page.evaluate(() => { const b = document.querySelector("#line2 .ab-play"); b.click(); b.click(); b.click(); });
  await sleep(700);
  check("rapid play ×3 leaves at most one live voice", (await live()) <= 1, `live=${await live()}`);
  await page.evaluate(() => { const ab = document.querySelector("#line2 .ab"); if (ab.classList.contains("playing")) ab.querySelector(".ab-play").click(); });
  await page.evaluate(() => { const ab = document.querySelector("#line3 .ab"); ab.querySelector(".ab-play").click();
    const t = ab.querySelectorAll(".take"); t[1].click(); t[2].click(); t[0].click(); t[2].click(); });
  await sleep(700);
  check("rapid take switching keeps one live voice", (await live()) === 1, `live=${await live()}`);
  const one = await page.evaluate(() => [document.querySelector("#line2 .ab").classList.contains("playing"), document.querySelector("#line3 .ab").classList.contains("playing")]);
  check("only one line plays at a time", !one[0] && one[1], JSON.stringify(one));
  await page.focus("#line3 .ab");
  const seq = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("b");
    await sleep(120);
    seq.push(await page.evaluate(() => [...document.querySelectorAll("#line3 .take")].findIndex((b) => b.getAttribute("aria-pressed") === "true")));
  }
  check("B cycles through all three line 3 takes", seq.join() === "0,1,2", seq.join());
  await page.keyboard.press("Space");
  const chip = await page.evaluateHandle(() => [...document.querySelectorAll("#line3 .co-chip")].find((c) => c.textContent.includes("S4c")));
  await chip.click();
  await sleep(300);
  const cc = await page.evaluate(() => ({ pressed: [...document.querySelectorAll("#line3 .take")].map((b) => b.getAttribute("aria-pressed")).join(),
    playing: document.querySelector("#line3 .ab").classList.contains("playing") }));
  check("callout chip S4c selects clone 2 and plays", cc.pressed === "false,false,true" && cc.playing, JSON.stringify(cc));
  await page.evaluate(() => document.querySelector("#figA .panel-play").click());
  await sleep(400);
  const pw = await page.evaluate(() => [document.querySelector("#line3 .ab").classList.contains("playing"), window.__live]);
  check("panel play stops the player and plays one window", !pw[0] && pw[1] === 1, JSON.stringify(pw));
  await sleep(1400);
  check("the window ends by itself", (await live()) === 0, `live=${await live()}`);
  await page.focus("#line1 .take[data-take='L1_me']");
  await page.keyboard.press("Space");
  await sleep(150);
  const sp = await page.evaluate(() => [document.querySelector("#line1 .take[data-take='L1_me']").getAttribute("aria-pressed"), document.querySelector("#line1 .ab").classList.contains("playing")]);
  check("Space on a take button selects it, no play toggle", sp[0] === "true" && !sp[1], JSON.stringify(sp));

  // ---- accessibility structure and honesty rules
  const roles = await page.evaluate(() => ({ btnInImg: document.querySelectorAll("[role=img] button").length, sliders: document.querySelectorAll("[role=slider]").length,
    groups: document.querySelectorAll(".ab[role=group]").length, readouts: document.querySelector("#readouts").getAttribute("role") }));
  check("no buttons inside role=img; players and readouts are groups", roles.btnInImg === 0 && roles.sliders === 0 && roles.groups === 3 && roles.readouts === "group", JSON.stringify(roles));
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-table="C"] tr')].map((tr) => tr.textContent));
  const failing = Object.values(M.lines).flatMap((L) => Object.entries(L.phrases).filter(([, p]) =>
    (p.octave_check_me && p.octave_check_me !== "pass") || (p.octave_check_clone && p.octave_check_clone !== "pass")).map(([n, p]) => [n, p]));
  check("pitch values that fail the octave check are withheld", failing.every(([n, p]) => {
    const row = rows.find((r) => r.includes(`"${n}"`));
    return row && row.includes("withheld") && !row.includes(String(p.f0_me.median_hz));
  }), failing.map(([n]) => n).join(", "));
  const fry = Object.values(M.lines).flatMap((L) => Object.entries(L.phrases).filter(([, p]) => p.comparable === false).map(([n]) => n));
  check("fry phrases are marked not comparable", fry.every((n) => rows.find((r) => r.includes(`"${n}"`) && r.includes("not comparable"))), fry.join(", "));
  const fa = await page.evaluate(() => ({ boxes: [...document.querySelectorAll("#figA .co-box .co-tag")].map((t) => t.textContent).sort().join(), fileEnd: document.querySelectorAll("#figA .file-end").length }));
  check("figure 1: callouts A1, A2, A3, A6, A7 and nothing past a file end", fa.boxes === "A1,A2,A3,A6,A7" && fa.fileEnd === 0, JSON.stringify(fa));

  // ---- chart hover
  for (const key of ["C", "subF0"]) {
    await page.evaluate((k) => document.querySelector(`[data-chart="${k}"]`).scrollIntoView({ block: "center" }), key);
    await sleep(150);
    const pt = await page.evaluate((k) => { const b = document.querySelector(`[data-chart="${k}"] svg`).getBoundingClientRect(); return { x: b.left + b.width * 0.4, y: b.top + 70 }; }, key);
    await page.mouse.move(pt.x, pt.y);
    await sleep(150);
    const tip = await page.evaluate((k) => { const t = document.querySelector(`[data-chart="${k}"] .tip`); return t && !t.hidden ? t.textContent : null; }, key);
    check(`chart ${key} hover tooltip`, !!tip, tip || "none");
  }

  // ---- phone
  await page.emulate(PHONE);
  await open(page);
  const mob = await page.evaluate(() => {
    const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const out = [];
    document.querySelectorAll(".chart svg").forEach((svg) => {
      const r = svg.getBoundingClientRect();
      const texts = [...svg.querySelectorAll("text")].map((t) => [t, t.getBoundingClientRect()]).filter(([, b]) => b.width);
      texts.forEach(([t, b]) => { if (b.left < r.left - 1 || b.right > r.right + 1) out.push("outside: " + t.textContent); });
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        if (overlap(texts[i][1], texts[j][1])) out.push(`overlap: ${texts[i][0].textContent} / ${texts[j][0].textContent}`);
      }
    });
    document.querySelectorAll(".file-end span").forEach((sp) => {
      const w = sp.closest(".spec-img-wrap").getBoundingClientRect(), b = sp.getBoundingClientRect();
      if (b.left < w.left || b.right > w.right) out.push("file-end label clipped");
    });
    document.querySelectorAll(".lg-item").forEach((it) => { const k = it.querySelector(".key"); if (k && Math.abs(k.getBoundingClientRect().top - it.getBoundingClientRect().top) > 20) out.push("legend key split from label"); });
    return { out, scrollW: document.documentElement.scrollWidth, w: innerWidth };
  });
  check("phone: no chart labels outside or overlapping; legends and labels intact", mob.out.length === 0, mob.out.slice(0, 6).join(" | "));
  check("phone: no horizontal page scroll", mob.scrollW <= mob.w, `${mob.scrollW} / ${mob.w}`);
  await page.evaluate(() => document.querySelector("#line1 .scorecard").scrollIntoView({ block: "center" }));
  await sleep(900);
  check("phone: meters light when the scorecard is on screen", (await page.evaluate(() => document.querySelectorAll("#line1 .meter i.on").length)) === 25);
  await page.evaluate(() => document.querySelector('[data-chart="C"]').scrollIntoView({ block: "center" }));
  await sleep(150);
  const pt = await page.evaluate(() => { const b = document.querySelector('[data-chart="C"] svg').getBoundingClientRect(); return { x: b.left + b.width * 0.9, y: b.top + 60 }; });
  await page.mouse.move(pt.x, pt.y);
  await sleep(150);
  const tb = await page.evaluate(() => { const t = document.querySelector('[data-chart="C"] .tip'); if (!t || t.hidden) return null; const b = t.getBoundingClientRect(); return [b.left, b.right, innerWidth]; });
  check("phone: tooltip stays on screen", tb && tb[0] >= 0 && tb[1] <= tb[2], JSON.stringify(tb));
  const small = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 32 || r.width < 32); }).length);
  check("phone: tap targets at least 32 px", small === 0, `${small} small`);

  // ---- print and reduced motion
  await page.emulateMediaType("print");
  const hidden = await page.evaluate(() => [...document.querySelectorAll(".co-box")].filter((b) => getComputedStyle(b).opacity === "0").length);
  check("print: callout boxes visible", hidden === 0, `${hidden} hidden`);
  await page.emulateMediaType("screen");
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await open(page);
  check("reduced motion stops the hero drift", (await page.evaluate(() => getComputedStyle(document.querySelector(".hero-band-track")).animationName)) === "none");

  check("no page errors or failed requests", errors.length === 0, errors.join(" ; "));
  await browser.close();

  // ---- opened straight from disk in an ordinary browser: fetch() is blocked, so the
  // players must fall back to <audio> elements and still play every line.
  const plain = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const pp = await plain.newPage();
  await pp.setViewport({ width: 1280, height: 900 });
  await pp.goto(FILE_URL, { waitUntil: "networkidle0" });
  await pp.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await sleep(600);
  for (const L of ["line1", "line2", "line3"]) {
    await pp.evaluate((l) => document.querySelector(`#${l} .ab`).scrollIntoView({ block: "center" }), L);
    await pp.click(`#${L} .ab-play`);
    await sleep(1600);   // <audio> has a cold-start delay on first load from disk
    const st = await pp.evaluate((l) => [document.querySelector(`#${l} .ab`).classList.contains("playing"), parseFloat(document.querySelector(`#${l} .ab-time`).textContent)], L);
    check(`from disk: ${L} plays`, st[0] && st[1] > 0.05, JSON.stringify(st));
    await pp.click(`#${L} .ab-play`);
  }
  await pp.evaluate(() => document.querySelector("#figA").scrollIntoView());
  await pp.click("#figA .panel-play");
  await sleep(300);
  check("from disk: figure play buttons work", !(await pp.$("#figA .audio-note")));
  await plain.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
