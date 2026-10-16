/* HSS sample browser. Plain JS, no build step; data comes from data/*.json
 * written by scripts/build_website.py. Routes:
 *   #/                overview: paper, leaderboard, featured examples
 *   #/browse?...      all tasks with filters
 *   #/task/<id>       one task: media + evidence window, prompt, answers, grades
 *   #/paper           arXiv links and key figures
 */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = () => $("#app");

let META, INDEX, BY_ID, MODEL;
const TASK_CACHE = new Map();
const REASONING_CACHE = new Map();
const ARXIV = "https://arxiv.org/abs/2610.08966";
const DEFAULT_SEL = ["human", "gpt-6-astra@max", "claude-opus-5.5@xhigh", "gemini-3.8-flash@high"];
let browseList = null; // ids in the order last shown in Browse, for prev/next

function md(text) {
  if (window.marked && window.DOMPurify) {
    return DOMPurify.sanitize(marked.parse(String(text || ""), { breaks: true }));
  }
  return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
}
const fmtTime = (s) => {
  if (s == null || isNaN(s)) return "–";
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};
const status = (p) => p == null
  ? `<span class="st none">– no result</span>`
  : p ? `<span class="st pass">✓ Pass</span>` : `<span class="st fail">✗ Fail</span>`;
const logo = (m, cls = "") => {
  const f = META.logos[m.company];
  return f ? `<img class="${cls}" src="logos/${encodeURIComponent(f)}" alt="" loading="lazy">` : "";
};
function mediaUrl(t) {
  const path = t.u || t.hf_path;
  return path ? META.hf_media_base + path : (t.url || t.media_url);
}
// HF first, original URL as a fallback when the HF file is unreachable.
function attachFallback(el, t) {
  const alt = t.url || t.media_url;
  el.addEventListener("error", () => {
    if (alt && el.dataset.fell !== "1") { el.dataset.fell = "1"; el.src = alt; }
  }, { once: false });
}
function getSelection() {
  try {
    const s = JSON.parse(localStorage.getItem("hss.sel"));
    if (Array.isArray(s)) return s.filter((k) => MODEL[k]);
  } catch (e) { /* ignore */ }
  return DEFAULT_SEL.filter((k) => MODEL[k]);
}
const setSelection = (keys) => localStorage.setItem("hss.sel", JSON.stringify(keys));

/* ------------------------------------------------------------------ boot */
async function boot() {
  const [meta, index] = await Promise.all([
    fetch("data/meta.json").then((r) => r.json()),
    fetch("data/index.json").then((r) => r.json()),
  ]);
  META = meta; INDEX = index;
  BY_ID = Object.fromEntries(INDEX.map((t) => [t.id, t]));
  MODEL = Object.fromEntries(META.models.map((m, i) => [m.key, { ...m, i }]));
  $("#hf-link").href = `https://huggingface.co/datasets/${META.hf_repo}`;
  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, query] = hash.split("?");
  const params = new URLSearchParams(query || "");
  const parts = path.split("/").filter(Boolean);
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active",
    a.dataset.nav === (parts[0] || "home") || (a.dataset.nav === "browse" && parts[0] === "task")));
  window.scrollTo(0, 0);
  if (parts[0] === "browse") return renderBrowse(params);
  if (parts[0] === "task" && parts[1]) return renderTask(parts[1]);
  if (parts[0] === "paper") return renderPaper();
  return renderHome();
}

/* ------------------------------------------------------------------ home */
// Share of models with a result on a task that solved it (raw API models only).
function solveRate(t) {
  let n = 0, k = 0;
  META.models.forEach((m, i) => {
    if (m.kind !== "raw" || t.o[i] == null) return;
    n++; k += t.o[i];
  });
  return { n, k };
}

function renderHome() {
  const nImg = INDEX.filter((t) => t.m === "image").length;
  const nCrit = INDEX.reduce((a, t) => a + (t.c || 0), 0);
  const nSub = Object.values(META.taxonomy).reduce((a, s) => a + Object.keys(s).length, 0);
  const raw = META.models.filter((m) => m.kind === "raw" && !m.extra);
  const best = raw.reduce((a, m) => (m.score > a.score ? m : a), raw[0]);
  const human = MODEL.human;
  const groups = {};
  META.featured.forEach((f) => (groups[f.group] ||= []).push(f));

  app().innerHTML = `
  <section class="hero">
    <div class="wordmark">
      <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M4 32C12 18 22 11 32 11s20 7 28 21c-8 14-18 21-28 21S12 46 4 32z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>
        <circle cx="32" cy="32" r="11" fill="var(--brand-accent)"/>
        <circle cx="32" cy="32" r="4.5" fill="currentColor"/>
      </svg>
      <h1><span>Humanity's</span> <span class="accent">Sixth Sense</span></h1>
    </div>
    <div class="subtitle">${esc(META.subtitle)}</div>
    <p class="tagline">What people infer at a glance, frontier models still miss.</p>
    <div class="labs">Scale AI · Elorian · 2026</div>
    <div class="actions">
      <a class="btn outline" href="${ARXIV}" target="_blank" rel="noopener">Paper</a>
      <a class="btn outline" href="https://huggingface.co/datasets/${esc(META.hf_repo)}" target="_blank" rel="noopener">Dataset</a>
      <a class="btn outline" href="https://scale.com/leaderboard/hss" target="_blank" rel="noopener">Scale Leaderboard</a>
      <a class="btn outline" href="#/browse">Browse ${INDEX.length} tasks</a>
    </div>
  </section>

  <h2 class="board-title">Leaderboard</h2>
  <div class="card board">
    <div id="board"></div>
  </div>

  <h2>About the benchmark</h2>
  <p class="abstract">${esc(META.abstract)}</p>
  <section class="stats">
    ${[[INDEX.length, "tasks"], [`${nImg} / ${INDEX.length - nImg}`, "images / videos"],
       [nCrit, "rubric criteria"], [`${Object.keys(META.taxonomy).length} / ${nSub}`, "domains / subdomains"],
       [`${human.score}%`, "human accuracy"], [`${best.score}%`, `best model in the paper (${best.name})`]]
      .map(([v, l]) => `<div class="card stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}
  </section>

  <h2>Representative examples</h2>
  ${Object.entries(groups).map(([g, items]) => `
    <h3 class="group-title">${esc(g)}</h3>
    <p class="muted">${g === "One failure per subdomain"
      ? "From the paper's appendix: for each subdomain, a task that GPT-6-astra, Gemini-3.8-flash and Claude-Opus-5.5 missed on every attempt."
      : "Worked examples from the paper's failure analysis."}</p>
    <div class="grid-cards">${items.map(featureCard).join("")}</div>`).join("")}

  <h2>Citation</h2>
  <pre class="bib">@misc{guo2026hss,
  title         = {Humanity's Sixth Sense: Benchmarking Intuitive Visual Reasoning in Multimodal Models},
  author        = {Xingang Guo and Jing Gu and Brian Jang and Renxiong Wang and Utkarsh Tyagi and
                   Daniel Quigley and Steven Li and David Yan and Daniel Yue Zhang and Darvin Yi and
                   Forrest Huang and HiJae Kim and Tianyi Zhang and Jared Lichtarge and Jihua Huang and
                   Le Xue and Manan Tomar and Qiuyi Richard Zhang and Ruofei Yu and Seth Neel and
                   Yaning Hu and Marcella Valentine and Xinzhe Jiang and Daniel Evans and
                   Chenguang Wang and Dustin Tran and Tong Zhao and Yinfei Yang and Yunzhong He},
  year          = {2026},
  eprint        = {2610.08966},
  archivePrefix = {arXiv},
  primaryClass  = {cs.AI},
  url           = {https://arxiv.org/abs/2610.08966}
}</pre>`;
  drawBoard();
}

function featureCard(f) {
  const t = BY_ID[f.id];
  if (!t) return "";
  const { n, k } = solveRate(t);
  const src = mediaUrl(t);
  const media = t.m === "image"
    ? `<img src="${esc(src)}" alt="" loading="lazy" data-id="${t.id}">`
    : `<video src="${esc(src)}#t=${t.w ? t.w.start : 0}" preload="metadata" muted playsinline data-id="${t.id}"></video>`;
  return `<a class="card ex" href="#/task/${t.id}">
    <div class="thumb">${media}<span class="badge">${t.m === "image" ? "Image" : "Video"}</span></div>
    <div class="body">
      <div class="title">${esc(f.title)}</div>
      <div><span class="pill">${esc(t.s)}</span></div>
      <div class="q">${esc(t.p)}</div>
      <div class="foot"><span class="muted">${esc(t.d)}</span><span>${k}/${n} models solve it</span></div>
    </div></a>`;
}

// Vendor hues from the paper's leaderboard figure (scripts/plot_leaderboard.py).
const VENDOR_COLOR = {
  OpenAI: "#1E7A50", Anthropic: "#B0541F", Google: "#478CC4", Meta: "#5E4B8B", Zhipu: "#8EA43D",
  Alibaba: "#BE64BD", Xiaomi: "#992154", Moonshot: "#00AA97", Human: "#473500",
};
const vendorColor = (m) => VENDOR_COLOR[m.company] || "#7A8288";

function drawBoard() {
  const rows = META.models.filter((m) => m.kind !== "agentic")
    .sort((a, b) => b.score - a.score);
  const ticks = [0, 20, 40, 60, 80, 100];
  const tip = $(".tooltip") || document.body.appendChild(Object.assign(document.createElement("div"), { className: "tooltip" }));
  $("#board").innerHTML = rows.map((m) => `
    <div class="bar-row" data-key="${esc(m.key)}">
      <div class="name">${logo(m)}<span>${esc(m.name)}</span>${m.effort ? `<span class="muted">${esc(m.effort)}</span>` : ""}</div>
      <div class="bar-track">
        <div class="bar" style="width:${m.score}%;background:${vendorColor(m)}"></div>
      </div>
      <div class="val">${m.score.toFixed(1)}</div>
    </div>`).join("") + `
    <div class="legend">${[...new Set(rows.map((m) => m.company))].map((c) =>
      `<span><i style="background:${VENDOR_COLOR[c] || "#7A8288"}"></i>${esc(c)}</span>`).join("")}</div>
    <div class="axis"><div></div><div class="ticks">${ticks.map((v) => `<span style="left:${v}%">${v}</span>`).join("")}</div><div></div></div>
    <p class="meta-line">Accuracy (%) on all 522 tasks. Human = annotators, reviewed by people.</p>`;
  $("#board").querySelectorAll(".bar-row").forEach((row) => {
    const m = MODEL[row.dataset.key];
    row.addEventListener("mousemove", (e) => {
      tip.style.display = "block";
      tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 12}px`;
      tip.innerHTML = `<b>${esc(m.name)}</b>${m.effort ? ` · ${esc(m.effort)}` : ""}<br>${m.score.toFixed(1)}%` + (m.company && m.company !== "Human" ? `<br>${esc(m.company)}` : "");
    });
    row.addEventListener("mouseleave", () => (tip.style.display = "none"));
  });
}

/* ---------------------------------------------------------------- browse */
function renderBrowse(params) {
  const domains = Object.keys(META.taxonomy);
  const f = {
    d: params.get("d") || "", s: params.get("s") || "", m: params.get("m") || "",
    q: params.get("q") || "", model: params.get("model") || "", out: params.get("out") || "",
    sort: params.get("sort") || "",
  };
  const subs = f.d ? Object.keys(META.taxonomy[f.d] || {}) : domains.flatMap((d) => Object.keys(META.taxonomy[d]));
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;
  app().innerHTML = `
    <h1>Browse tasks</h1>
    <div class="filters">
      <input type="search" id="f-q" placeholder="Search question text or task id…" value="${esc(f.q)}">
      <select id="f-d">${opt("", "All domains", f.d)}${domains.map((d) => opt(d, d, f.d)).join("")}</select>
      <select id="f-s">${opt("", "All subdomains", f.s)}${subs.map((s) => opt(s, s, f.s)).join("")}</select>
      <select id="f-m">${opt("", "Image + video", f.m)}${opt("image", "Image", f.m)}${opt("video", "Video", f.m)}</select>
      <select id="f-model">${opt("", "Outcome for model…", f.model)}${META.models.map((m) => opt(m.key, m.name + (m.effort ? ` (${m.effort})` : ""), f.model)).join("")}</select>
      <select id="f-out" ${f.model ? "" : "disabled"}>${opt("", "pass or fail", f.out)}${opt("pass", "passed", f.out)}${opt("fail", "failed", f.out)}</select>
      <select id="f-sort">${opt("", "Dataset order", f.sort)}${opt("hard", "Hardest first", f.sort)}${opt("easy", "Easiest first", f.sort)}</select>
    </div>
    <div id="count" class="muted"></div>
    <table class="tasks"><thead><tr>
      <th>Task</th><th>Subdomain</th><th>Media</th><th>Question</th><th>Models solving</th>${f.model ? `<th>${esc(MODEL[f.model]?.name || "")}</th>` : ""}
    </tr></thead><tbody id="rows"></tbody></table>`;

  const q = f.q.toLowerCase();
  const mi = f.model ? MODEL[f.model].i : -1;
  let list = INDEX.filter((t) => (!f.d || t.d === f.d) && (!f.s || t.s === f.s) && (!f.m || t.m === f.m) &&
    (!q || t.p.toLowerCase().includes(q) || t.id.includes(q)) &&
    (!f.model || !f.out || t.o[mi] === (f.out === "pass" ? 1 : 0)));
  if (f.sort) {
    const r = (t) => { const { n, k } = solveRate(t); return n ? k / n : 0; };
    list = [...list].sort((a, b) => (f.sort === "hard" ? r(a) - r(b) : r(b) - r(a)));
  }
  browseList = list.map((t) => t.id);
  $("#count").textContent = `${list.length} of ${INDEX.length} tasks`;
  $("#rows").innerHTML = list.map((t) => {
    const { n, k } = solveRate(t);
    return `<tr data-id="${t.id}">
      <td><code>${t.id.slice(-8)}</code></td>
      <td>${esc(t.s)}<div class="muted" style="font-size:.75rem">${esc(t.d)}</div></td>
      <td>${t.m === "image" ? "🖼 image" : `🎞 video${t.w ? `<div class="muted" style="font-size:.75rem">evidence ${esc(t.w.start_label)}–${esc(t.w.end_label)}</div>` : ""}`}</td>
      <td>${esc(t.p)}</td>
      <td><div class="solve"><div class="track"><div class="fill" style="width:${n ? (100 * k) / n : 0}%"></div></div>${k}/${n}</div></td>
      ${f.model ? `<td>${status(t.o[mi])}</td>` : ""}
    </tr>`;
  }).join("");
  $("#rows").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) location.hash = `#/task/${tr.dataset.id}`;
  });

  const update = () => {
    const p = new URLSearchParams();
    const val = (id) => $(id).value;
    [["q", "#f-q"], ["d", "#f-d"], ["s", "#f-s"], ["m", "#f-m"], ["model", "#f-model"], ["out", "#f-out"], ["sort", "#f-sort"]]
      .forEach(([k, id]) => val(id) && p.set(k, val(id)));
    if ($("#f-d").value !== f.d) p.delete("s");
    history.replaceState(null, "", `#/browse?${p}`);
    renderBrowse(p);
  };
  let timer;
  $("#f-q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { update(); const el = $("#f-q"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); });
  ["#f-d", "#f-s", "#f-m", "#f-model", "#f-out", "#f-sort"].forEach((id) => $(id).addEventListener("change", update));
}

/* ------------------------------------------------------------------ task */
async function loadTask(id) {
  if (!TASK_CACHE.has(id)) TASK_CACHE.set(id, fetch(`data/tasks/${id}.json`).then((r) => {
    if (!r.ok) throw new Error(`task ${id} not found`);
    return r.json();
  }));
  return TASK_CACHE.get(id);
}
async function loadReasoning(id) {
  if (!REASONING_CACHE.has(id)) REASONING_CACHE.set(id, fetch(`data/reasoning/${id}.json`).then((r) => (r.ok ? r.json() : {})));
  return REASONING_CACHE.get(id);
}

async function renderTask(id) {
  app().innerHTML = `<p class="loading">Loading task…</p>`;
  let t;
  try { t = await loadTask(id); } catch (e) { app().innerHTML = `<p class="media-err">${esc(e.message)}</p>`; return; }
  const list = browseList && browseList.includes(id) ? browseList : INDEX.map((x) => x.id);
  const pos = list.indexOf(id);
  const prev = list[pos - 1], next = list[pos + 1];
  const src = mediaUrl(t);

  app().innerHTML = `
    <div class="crumbs">
      <div><a href="#/browse">Tasks</a> › <a href="#/browse?d=${encodeURIComponent(t.domain)}">${esc(t.domain)}</a> ›
        <a href="#/browse?d=${encodeURIComponent(t.domain)}&s=${encodeURIComponent(t.subdomain)}">${esc(t.subdomain)}</a>
        <span class="muted"> · <code>${t.id}</code></span></div>
      <div>${prev ? `<a class="btn small" href="#/task/${prev}">← Prev</a>` : ""}
        <span class="muted">${pos + 1} / ${list.length}</span>
        ${next ? `<a class="btn small" href="#/task/${next}">Next →</a>` : ""}</div>
    </div>
    <div class="task-top">
      <div class="card media-box">
        ${t.media_type === "image"
          ? `<img id="media" src="${esc(src)}" alt="task image">`
          : `<video id="media" src="${esc(src)}" controls preload="metadata" playsinline></video>
             ${t.evidence_window ? `
             <div class="timeline" id="tl" title="Click to seek"><div class="win" id="tl-win"></div><div class="head" id="tl-head"></div></div>
             <div class="ev-controls">
               <span class="ev-label"><span class="sw"></span>Evidence window ${esc(t.evidence_window.start_label)}–${esc(t.evidence_window.end_label)}</span>
               <button class="btn small primary" id="ev-play">▶ Play evidence window</button>
               <label><input type="checkbox" id="ev-loop"> loop</label>
               <span class="muted" id="ev-clock"></span>
             </div>
             <p class="meta-line">The window is the stretch of the clip where the annotator located the evidence for the answer. Models received the whole video.</p>` : ""}`}
        <div class="meta-line"><a href="${esc(src)}" target="_blank" rel="noopener">Open media ↗</a> ·
          <a href="${esc(t.media_url)}" target="_blank" rel="noopener">original source ↗</a></div>
        <div id="media-err" class="media-err"></div>
      </div>
      <div class="card qa">
        <h4>Question</h4><div class="question">${esc(t.prompt)}</div>
        <h4>Reference answer (human-written)</h4><div>${esc(t.golden_response)}</div>
        <h4>Rubric — every criterion must be met</h4>
        <ol class="rubric">${t.rubric.map((c) => `<li>${esc(c.title)}</li>`).join("")}</ol>
        <details class="prompt" id="prompt"><summary>Full prompt sent to the models</summary><div id="prompt-body"></div></details>
      </div>
    </div>
    <section class="picker card">
      <div class="picker-head">
        <h3 style="margin:0">Model responses &amp; judge grades</h3>
        <div class="picker-presets">
          <button class="btn small" data-preset="default">Default</button>
          <button class="btn small" data-preset="top">Top 6</button>
          <button class="btn small" data-preset="pass">All that passed</button>
          <button class="btn small" data-preset="fail">All that failed</button>
          <button class="btn small" data-preset="agentic">Agents</button>
          <button class="btn small" data-preset="all">All</button>
          <button class="btn small" data-preset="none">Clear</button>
        </div>
      </div>
      <div id="chips"></div>
    </section>
    <div class="answers" id="answers"></div>
    <div class="lightbox" id="lb"><img alt=""></div>`;

  const media = $("#media");
  attachFallback(media, t);
  media.addEventListener("error", () => {
    if (media.dataset.fell === "1") $("#media-err").textContent = "Media could not be loaded from the HF dataset or the original URL.";
  });
  if (t.media_type === "image") {
    media.addEventListener("click", () => { const lb = $("#lb"); lb.querySelector("img").src = media.currentSrc || media.src; lb.style.display = "flex"; });
    $("#lb").addEventListener("click", () => ($("#lb").style.display = "none"));
  } else if (t.evidence_window) {
    wireEvidence(media, t.evidence_window);
  }

  const outcome = (key) => {
    const atts = t.runs[key];
    return atts ? atts.every((a) => a.pass) : null;
  };
  let sel = getSelection();
  const drawChips = () => {
    const groups = [["Human", "human"], ["Models (single API call)", "raw"], ["Agent harnesses", "agentic"]];
    $("#chips").innerHTML = groups.map(([label, kind]) => {
      const ms = META.models.filter((m) => m.kind === kind);
      return `<div class="chip-group"><div class="gl">${label}</div><div class="chips">${ms.map((m) => {
        const o = outcome(m.key);
        return `<span class="chip ${sel.includes(m.key) ? "on" : ""} ${o == null ? "disabled" : ""}" data-key="${esc(m.key)}"
          title="${o == null ? "No result on this task" : o ? "Passed" : "Failed"}">
          ${logo(m)}${esc(m.name)}${m.effort ? `<span class="muted">${esc(m.effort)}</span>` : ""}
          <span class="mk ${o == null ? "" : o ? "pass" : "fail"}">${o == null ? "–" : o ? "✓" : "✗"}</span></span>`;
      }).join("")}</div></div>`;
    }).join("");
  };
  const draw = () => {
    setSelection(sel);
    drawChips();
    drawPrompt(t, sel);
    $("#answers").innerHTML = sel.filter((k) => t.runs[k]).map((k) => answerCard(t, MODEL[k])).join("") ||
      `<p class="muted">Pick one or more models above to see their answers.</p>`;
    wireAnswers(t);
  };
  $("#chips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c || c.classList.contains("disabled")) return;
    const k = c.dataset.key;
    sel = sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k];
    draw();
  });
  app().querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    const has = META.models.filter((m) => t.runs[m.key]);
    sel = {
      default: DEFAULT_SEL,
      top: has.filter((m) => m.kind === "raw").sort((a, b) => b.score - a.score).slice(0, 6).map((m) => m.key),
      pass: has.filter((m) => outcome(m.key)).map((m) => m.key),
      fail: has.filter((m) => outcome(m.key) === false).map((m) => m.key),
      agentic: has.filter((m) => m.kind === "agentic").map((m) => m.key),
      all: has.map((m) => m.key),
      none: [],
    }[b.dataset.preset];
    draw();
  }));
  draw();
}

function wireEvidence(video, w) {
  const tl = $("#tl"), win = $("#tl-win"), head = $("#tl-head"), clock = $("#ev-clock");
  let playingWindow = false;
  const place = () => {
    const d = video.duration;
    if (!d || !isFinite(d)) return;
    const s = Math.min(w.start, d), e = Math.min(Math.max(w.end, s + 0.25), d);
    win.style.left = `${(100 * s) / d}%`;
    win.style.width = `${Math.max((100 * (e - s)) / d, 0.4)}%`;
  };
  video.addEventListener("loadedmetadata", () => {
    place();
    // Park on the first frame of the window so the still shows the evidence.
    if (video.currentTime < 0.01 && w.start > 0) video.currentTime = Math.min(w.start, video.duration);
  });
  video.addEventListener("timeupdate", () => {
    const d = video.duration || 1;
    head.style.left = `${(100 * video.currentTime) / d}%`;
    clock.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    if (playingWindow && video.currentTime >= w.end) {
      if ($("#ev-loop").checked) video.currentTime = w.start;
      else { video.pause(); playingWindow = false; }
    }
  });
  video.addEventListener("seeking", () => {
    if (playingWindow && (video.currentTime < w.start - 0.5 || video.currentTime > w.end + 0.5)) playingWindow = false;
  });
  $("#ev-play").addEventListener("click", () => {
    playingWindow = true;
    video.currentTime = w.start;
    video.play();
  });
  tl.addEventListener("click", (e) => {
    const r = tl.getBoundingClientRect();
    if (video.duration) video.currentTime = ((e.clientX - r.left) / r.width) * video.duration;
  });
}

function drawPrompt(t, sel) {
  const names = (keys) => keys.map((k) => MODEL[k]?.name).filter(Boolean);
  const reqs = t.requests.filter((r) => r.kind !== "human")
    .map((r, i) => ({ ...r, i, chosen: r.models.some((k) => sel.includes(k)) }));
  reqs.sort((a, b) => b.chosen - a.chosen);
  const block = (b) => b.type === "media"
    ? `<span class="block-media">${esc(b.text)}</span>`
    : `<pre>${esc(b.text)}</pre>`;
  $("#prompt-body").innerHTML = reqs.map((r) => {
      const who = r.models.length ? `Used by: ${esc(names(r.models).join(", "))}` : "Default request";
      if (r.kind === "agentic") return `<div class="req"><div class="who">${who}</div>
        <div class="msg"><div class="role">agent harness · instruction.md</div><pre>${esc(r.instruction || "(instruction not available)")}</pre></div>
        <p class="meta-line">${esc(r.note)}</p></div>`;
      return `<div class="req"><div class="who">${who}</div>
        <div class="msg"><div class="role">user</div>${r.user.map(block).join("")}</div></div>`;
    }).join("");
}

function answerCard(t, m) {
  const atts = t.runs[m.key];
  const pass = atts.every((a) => a.pass);
  const nPass = atts.filter((a) => a.pass).length;
  const tone = pass ? "pass" : nPass ? "partial" : "fail";
  return `<article class="card ans ${tone}" data-key="${esc(m.key)}">
    <div class="ans-head">
      <div><div class="nm">${logo(m)}${esc(m.name)}</div>
        <div class="meta-line">${m.kind === "agentic" ? "agent harness" : m.kind === "human" ? "human annotator" : "single API call"}${m.effort ? ` · effort ${esc(m.effort)}` : ""}</div></div>
      <div style="text-align:right">${atts.length > 1
        ? `<span class="att-count ${tone}">${nPass}/${atts.length} attempts passed</span>`
        : status(pass)}</div>
    </div>
    ${atts.length > 1 ? `<div class="tabs">${atts.map((a, i) => `<button class="btn small att ${a.pass ? "pass" : "fail"}" data-att="${i}" aria-pressed="${i === 0}">Attempt ${a.attempt} ${a.pass ? "✓" : "✗"}</button>`).join("")}</div>` : ""}
    <div class="att-body">${attemptBody(t, m, atts[0])}</div>
  </article>`;
}

function attemptBody(t, m, a) {
  const crit = Object.fromEntries((a.criteria || []).map((c) => [c.id, c]));
  const usage = a.usage || {};
  const bits = [usage.prompt_tokens && `${usage.prompt_tokens.toLocaleString()} input tok`,
    usage.completion_tokens && `${usage.completion_tokens.toLocaleString()} output tok`,
    a.steps && `${a.steps} agent steps`].filter(Boolean);
  return `
    <div class="answer-text">${a.answer ? md(a.answer) : `<p class="muted">(empty answer)</p>`}</div>
    ${a.has_reasoning ? `<details class="reasoning" data-rk="${esc(m.key)}#${a.attempt}"><summary>Reasoning trace (as returned by the API)</summary><pre>Loading…</pre></details>` : ""}
    <div class="grades">
      ${a.reviewed
        ? `<div class="judge-comment">Graded by human review: ${a.pass ? "PASS" : "FAIL"} (no per-criterion LLM grades).</div>`
        : t.rubric.map((c, i) => {
            const g = crit[c.id] || (a.criteria || [])[i] || {};
            return `<div class="grade"><div>${status(g.met == null ? null : g.met)}</div>
              <div><div class="crit">${esc(c.title)}</div><div class="just">${esc(g.justification || "")}</div></div></div>`;
          }).join("") + (a.judge_comment ? `<div class="judge-comment">Judge (${esc(META.judge)}): ${esc(a.judge_comment)}</div>` : "")}
    </div>
    ${bits.length ? `<div class="meta-line">${bits.join(" · ")}</div>` : ""}`;
}

function wireAnswers(t) {
  const wireReasoning = (root) => root.querySelectorAll("details.reasoning").forEach((d) => d.addEventListener("toggle", async () => {
    if (!d.open || d.dataset.loaded) return;
    const r = await loadReasoning(t.id);
    d.querySelector("pre").textContent = r[d.dataset.rk] || "(not available)";
    d.dataset.loaded = "1";
  }));
  $("#answers").querySelectorAll(".ans").forEach((card) => {
    const m = MODEL[card.dataset.key];
    card.querySelectorAll("[data-att]").forEach((b) => b.addEventListener("click", () => {
      card.querySelectorAll("[data-att]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      card.querySelector(".att-body").innerHTML = attemptBody(t, m, t.runs[m.key][+b.dataset.att]);
      wireReasoning(card);
    }));
    wireReasoning(card);
  });
}

/* ----------------------------------------------------------------- paper */
function renderPaper() {
  app().innerHTML = `
    <h1>${esc(META.title)}: ${esc(META.subtitle)}</h1>
    <p class="actions">
      <a class="btn primary" href="${ARXIV}" target="_blank" rel="noopener">Paper ↗</a>
    </p>
    <h2>Key figures</h2>
    <div class="figs">${META.figures.map((f) => `<figure><img src="${esc(f.file)}" alt="${esc(f.caption)}" loading="lazy"><figcaption>${esc(f.caption)}</figcaption></figure>`).join("")}</div>
    <div class="lightbox" id="lb"><img alt=""></div>`;
  app().querySelectorAll(".figs img").forEach((img) => img.addEventListener("click", () => {
    const lb = $("#lb"); lb.querySelector("img").src = img.src; lb.style.display = "flex";
  }));
  $("#lb").addEventListener("click", () => ($("#lb").style.display = "none"));
}

boot().catch((e) => { app().innerHTML = `<p class="media-err">Failed to load site data: ${esc(e.message)}. Serve this folder over HTTP (python -m http.server), not file://.</p>`; });
