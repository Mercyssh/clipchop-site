// ClipChop site. One scroll loop writes a 0→1 progress `--p` onto every
// [data-scroll] element (CSS turns that into the animations), runs a few
// per-scene hooks for text that changes, and drives the page scrubber.

(() => {
  "use strict";

  // ---- Downloads ----------------------------------------------------------
  // Point these at the real installer URLs. Until then they all open the
  // latest GitHub release.
  const RELEASES = "https://github.com/Mercyssh/Clippy/releases/latest";
  const DOWNLOADS = {
    "windows-exe": RELEASES,
    "windows-msi": RELEASES,
    "mac-dmg": RELEASES,
    "linux-appimage": RELEASES,
    "linux-deb": RELEASES,
    "linux-rpm": RELEASES,
  };
  const PRIMARY = { windows: "windows-exe", mac: "mac-dmg", linux: "linux-appimage" };
  const OS_NAME = { windows: "Windows", mac: "macOS", linux: "Linux" };

  function detectOS() {
    const p = (navigator.userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
    const ua = navigator.userAgent.toLowerCase();
    if (/android|iphone|ipad|ipod/.test(ua)) return null; // phones: no desktop build
    if (p.includes("win")) return "windows";
    if (p.includes("mac")) return "mac";
    if (p.includes("linux") || p.includes("x11")) return "linux";
    return null;
  }

  document.querySelectorAll("[data-asset]").forEach((a) => {
    a.href = DOWNLOADS[a.dataset.asset] ?? RELEASES;
  });
  const os = detectOS();
  if (os) {
    document.querySelectorAll("[data-dl]").forEach((a) => {
      a.href = DOWNLOADS[PRIMARY[os]];
      if (a.hasAttribute("data-dl-label")) a.textContent = `Download for ${OS_NAME[os]}`;
    });
    document.querySelector(`.plat[data-os="${os}"]`)?.classList.add("mine");
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Small DOM prep -----------------------------------------------------
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  // App-style wavy wordmark.
  document.querySelectorAll("[data-wavy]").forEach((el) => {
    if (reduced) return;
    const text = el.textContent;
    el.setAttribute("aria-label", text);
    el.textContent = "";
    [...text].forEach((ch, i) => {
      const s = document.createElement("span");
      s.className = "wavy-char";
      s.style.setProperty("--i", i);
      s.setAttribute("aria-hidden", "true");
      s.textContent = ch;
      el.append(s);
    });
    el.classList.add("wavy");
  });

  // Split text into word spans with an index (captions plate, personal note).
  function splitWords(el, cls) {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    el.style.setProperty("--n", words.length);
    words.forEach((w, i) => {
      const s = document.createElement("span");
      s.className = cls;
      s.style.setProperty("--i", i);
      s.textContent = w;
      el.append(s, " ");
    });
    return [...el.querySelectorAll("." + cls)];
  }
  const capWords = splitWords(document.querySelector("[data-words]"), "w");
  document.querySelectorAll("[data-reveal]").forEach((el) => splitWords(el, "rw"));

  // Fake waveform bars for the captions scene.
  const wave = document.querySelector("[data-wave]");
  const bars = [];
  for (let i = 0; i < 72; i++) {
    const b = document.createElement("span");
    const h = 18 + 70 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21)) + (i % 5) * 2;
    b.style.setProperty("--h", Math.min(100, h).toFixed(0) + "%");
    wave.append(b);
    bars.push(b);
  }

  // ---- Per-scene hooks (text that changes with progress) -------------------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const range = (p, a, b) => clamp((p - a) / (b - a));
  const setText = (el, t) => {
    if (el && el.textContent !== t) el.textContent = t;
  };

  const speedPill = document.querySelector("[data-speed]");
  const capStatus = document.querySelector("[data-cap-status]");
  const capPct = document.querySelector("[data-cap-pct]");
  const frameSub = document.querySelector("[data-frame-sub]");
  const typed = document.querySelector("[data-typed]");
  const aiHead = document.querySelector("[data-ai-head]");
  const aiStatus = document.querySelector("[data-ai-status]");
  const renderPct = document.querySelector("[data-render-pct]");
  const renderStatus = document.querySelector("[data-render-status]");
  const aiChips = [...document.querySelectorAll("#ai .chip")];

  const hooks = {
    speed(p) {
      const q = range(p, 0.15, 0.75);
      setText(speedPill, q < 0.05 ? "1×" : q < 0.5 ? "4×" : "8×");
    },
    captions(p, el) {
      const q = range(p, 0.18, 0.8);
      const done = q >= 1;
      setText(capStatus, q < 0.06 ? "Loading Model" : done ? "Done" : "Transcribing");
      setText(capPct, Math.round(q * 100) + "%");
      capStatus.parentElement.classList.toggle("done", done);
      const hot = Math.floor(q * capWords.length * 1.05 - 0.0001);
      capWords.forEach((w, i) => w.classList.toggle("hot", i === hot && !done));
      const lit = Math.floor(q * bars.length);
      bars.forEach((b, i) => b.classList.toggle("lit", i < lit));
    },
    frames(p) {
      setText(frameSub, p < 0.52 ? "Black-box anything private." : "Then add a title, or a sticker.");
    },
    ai(p) {
      const full = typed.dataset.typed;
      setText(typed, full.slice(0, Math.round(range(p, 0.04, 0.24) * full.length)));
      const count = new Set(
        aiChips.filter((c) => p >= parseFloat(c.style.getPropertyValue("--s")) + 0.02).map((c) => c.style.getPropertyValue("--s")),
      ).size;
      const head = p < 0.28 ? "Describe the edit." : p < 0.72 ? "Your AI makes the first cut." : "You make the final one.";
      if (aiHead.dataset.state !== head) {
        aiHead.dataset.state = head;
        aiHead.innerHTML = p < 0.72 && p >= 0.28 ? 'Your AI makes <span class="c-grad">the first cut.</span>' : head;
      }
      let status;
      if (p < 0.27) status = "Waiting for your AI";
      else if (count < 10) status = `Editing · ${count} ${count === 1 ? "edit" : "edits"}`;
      else if (p < 0.76) status = "✓ Done · 10 edits";
      else status = "Stretch a cut. Nudge a box. It's all yours.";
      setText(aiStatus, status);
      aiStatus.classList.toggle("done", count >= 10 && p < 0.76);
    },
    render(p, el) {
      const q = range(p, 0.1, 0.75);
      setText(renderPct, String(Math.round(q * 100)));
      const done = q >= 1;
      el.classList.toggle("done", done);
      setText(renderStatus, done ? "✓ Done. Your MP4 is ready." : "Rendering · H.264 · matched to your footage");
    },
  };

  // ---- Scroll engine ------------------------------------------------------
  const scrolled = [...document.querySelectorAll("[data-scroll]")];

  function progress(el, vh) {
    const r = el.getBoundingClientRect();
    if (el.dataset.scroll === "pin") return clamp(-r.top / Math.max(1, r.height - vh));
    return clamp((vh - r.top) / (vh + r.height)); // "through": enters bottom → leaves top
  }

  function update() {
    const vh = innerHeight;
    for (const el of scrolled) {
      const p = reduced ? (el.dataset.scroll === "pin" ? 1 : 0.5) : progress(el, vh);
      const v = p.toFixed(4);
      if (el._p !== v) {
        el._p = v;
        el.style.setProperty("--p", v);
        hooks[el.id]?.(p, el);
      }
    }
    updateChrome(vh);
  }

  // ---- Scrubber, top bar, ambient colour ----------------------------------
  const scrubber = document.querySelector("[data-scrubber]");
  const track = document.querySelector("[data-scrub-track]");
  const head = document.querySelector("[data-scrub-head]");
  const tc = document.querySelector("[data-tc]");
  const topbar = document.querySelector("[data-topbar]");
  const hero = document.querySelector(".hero");
  const segEls = [...document.querySelectorAll("[data-seg]")];
  const DURATION = 53.7; // the launch video's length, for the timecode
  let segs = [];

  function buildScrubber() {
    track.querySelectorAll(".scrub-seg").forEach((s) => s.remove());
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    segs = segEls.map((el, i) => {
      const top = el.getBoundingClientRect().top + scrollY;
      const next = segEls[i + 1];
      const end = next ? next.getBoundingClientRect().top + scrollY : max + innerHeight;
      return { el, a: clamp(top / max), b: clamp(end / max) };
    });
    segs[0].a = 0;
    segs.forEach((s) => {
      const a = document.createElement("a");
      a.className = "scrub-seg";
      a.href = "#" + (s.el.id || "");
      a.style.flex = `${Math.max(0.01, s.b - s.a)} 1 0`;
      a.style.setProperty("--c", s.el.dataset.seg);
      a.setAttribute("aria-label", s.el.dataset.name);
      a.innerHTML = `<span>${s.el.dataset.name}</span>`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        scrollTo({ top: s.el.getBoundingClientRect().top + scrollY, behavior: reduced ? "auto" : "smooth" });
      });
      track.insertBefore(a, head);
      s.link = a;
    });
  }

  let activeSeg = null;
  function updateChrome(vh) {
    const max = Math.max(1, document.documentElement.scrollHeight - vh);
    const t = clamp(scrollY / max);
    head.style.left = `calc(${(t * 100).toFixed(3)}% - 1px)`;

    const secs = t * DURATION;
    const mm = Math.floor(secs / 60);
    const ss = Math.floor(secs % 60);
    const ff = Math.floor((secs % 1) * 30);
    setText(tc, [mm, ss, ff].map((n) => String(n).padStart(2, "0")).join(":"));

    const past = scrollY > hero.offsetHeight * 0.55;
    scrubber.classList.toggle("show", past);
    topbar.classList.toggle("show", past);

    const mid = scrollY + vh * 0.5;
    let cur = segEls[0];
    for (const el of segEls) if (el.getBoundingClientRect().top + scrollY <= mid) cur = el;
    if (cur !== activeSeg) {
      activeSeg = cur;
      document.documentElement.style.setProperty("--amb", cur.dataset.seg);
      segs.forEach((s) => s.link?.classList.toggle("on", s.el === cur));
    }
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      update();
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => {
    buildScrubber();
    onScroll();
  });
  addEventListener("load", () => {
    buildScrubber();
    update();
  });
  buildScrubber();
  update();

  // ---- Feature loops: play only while on screen ---------------------------
  const loops = [...document.querySelectorAll("video.loop")];
  if (!reduced && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) e.target.play().catch(() => {});
          else e.target.pause();
        }
      },
      { rootMargin: "100px 0px", threshold: 0.15 },
    );
    loops.forEach((v) => io.observe(v));
  }

  // ---- Launch video: poster first, click to play with sound ---------------
  const launch = document.getElementById("launch");
  const playBtn = document.querySelector("[data-play]");
  playBtn.addEventListener("click", () => {
    launch.muted = false;
    launch.controls = true;
    playBtn.classList.add("hidden");
    launch.play().catch(() => {});
  });
})();
