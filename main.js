// ClipChop site. One scroll loop writes a 0→1 progress `--p` onto every
// [data-scroll] element (CSS turns that into the animations), runs a few
// per-scene hooks for text that changes, and drives the page scrubber.

(() => {
  "use strict";

  // ---- Downloads ----------------------------------------------------------
  // Installers live on the public releases repo. Each release uploads them
  // under these stable names, so "latest/download/<name>" always serves the
  // newest version and these links never need editing.
  const RELEASES = "https://github.com/Mercyssh/clipchop-releases/releases/latest";
  const FILE = (name) => `${RELEASES}/download/${name}`;
  const DOWNLOADS = {
    "windows-exe": FILE("ClipChop_x64-setup.exe"),
    "windows-msi": FILE("ClipChop_x64_en-US.msi"),
    "mac-dmg": FILE("ClipChop_aarch64.dmg"),
    "linux-appimage": FILE("ClipChop_amd64.AppImage"),
    "linux-deb": FILE("ClipChop_amd64.deb"),
    "linux-rpm": FILE("ClipChop_x86_64.rpm"),
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
      if (a.hasAttribute("data-dl-label")) {
        // Label plus the platform's logo, borrowed from its download card.
        a.textContent = `Download for ${OS_NAME[os]}`;
        const icon = document.querySelector(`.plat[data-os="${os}"] .plat-icon`)?.cloneNode(true);
        if (icon) {
          icon.setAttribute("class", "os-icon");
          a.prepend(icon);
        }
      }
    });
    document.querySelector(`.plat[data-os="${os}"]`)?.classList.add("mine");
  }

  // ---- Analytics (Umami, cookieless) --------------------------------------
  // trackEvent() is a no-op until the Umami script has loaded (or if it's blocked).
  const trackEvent = (name, data) => {
    try {
      window.umami?.track(name, data);
    } catch {}
  };
  // Download clicks: which platform/format, and which button it came from.
  document.querySelectorAll("[data-dl]").forEach((a) =>
    a.addEventListener("click", () =>
      trackEvent("download-click", { platform: os ?? "unknown", file: os ? PRIMARY[os] : "none", from: a.closest(".scrubber") ? "bar" : "hero" }),
    ),
  );
  document.querySelectorAll("[data-asset]").forEach((a) =>
    a.addEventListener("click", () =>
      trackEvent("download-click", { platform: a.closest(".plat")?.dataset.os ?? "unknown", file: a.dataset.asset, from: "cards" }),
    ),
  );
  document.querySelectorAll("[data-feedback]").forEach((a) => a.addEventListener("click", () => trackEvent("feedback-click")));

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Small DOM prep -----------------------------------------------------
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

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
      const state = p < 0.52 ? "a" : "b";
      if (frameSub.dataset.state !== state) {
        frameSub.dataset.state = state;
        frameSub.innerHTML =
          state === "a"
            ? 'Black-box anything <span class="c-frame">private.</span>'
            : 'Then add a <span class="c-frame">title</span>, or a <span class="c-frame">sticker</span>.';
      }
    },
    ai(p) {
      const full = typed.dataset.typed;
      setText(typed, full.slice(0, Math.round(range(p, 0.04, 0.24) * full.length)));
      const count = new Set(
        aiChips.filter((c) => p >= parseFloat(c.style.getPropertyValue("--s")) + 0.02).map((c) => c.style.getPropertyValue("--s")),
      ).size;
      const head = p < 0.28 ? "Describe the edit." : p < 0.68 ? "Your AI makes the first cut." : "You make the final one.";
      if (aiHead.dataset.state !== head) {
        aiHead.dataset.state = head;
        aiHead.innerHTML = p < 0.68 && p >= 0.28 ? 'Your AI makes <span class="c-grad">the first cut.</span>' : head;
      }
      let status;
      if (p < 0.27) status = "Waiting for your AI";
      else if (count < 10) status = `Editing · ${count} ${count === 1 ? "edit" : "edits"}`;
      else if (p < 0.68) status = "✓ Done · 10 edits";
      else status = "Stretch a cut. Nudge a box. It's all yours.";
      setText(aiStatus, status);
      aiStatus.classList.toggle("done", count >= 10 && p < 0.68);
    },
    render(p, el) {
      const q = range(p, 0.1, 0.75);
      setText(renderPct, String(Math.round(q * 100)));
      const done = q >= 1;
      el.classList.toggle("done", done);
      setText(renderStatus, done ? "✓ Done. Your MP4 is ready." : "Rendering · H.264 · matched to your footage");
    },
  };

  // ---- Smooth scroll ------------------------------------------------------
  // Lenis (vendor/lenis.min.js) smooths wheel scrolling; it is driven from the
  // single animation loop at the bottom of this file. Off for reduced motion.
  const lenis = !reduced && window.Lenis ? new window.Lenis({ lerp: 0.1, anchors: true }) : null;
  const scrollToEl = (el) => (lenis ? lenis.scrollTo(el) : el.scrollIntoView());

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
        scrollToEl(s.el);
      });
      track.insertBefore(a, head);
      s.link = a;
    });
  }

  let activeSeg = null;
  const seenSegs = new Set(); // for drop-off: each section is reported once per visit
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

    const mid = scrollY + vh * 0.5;
    let cur = segEls[0];
    for (const el of segEls) if (el.getBoundingClientRect().top + scrollY <= mid) cur = el;
    if (cur !== activeSeg) {
      activeSeg = cur;
      if (!seenSegs.has(cur)) {
        seenSegs.add(cur);
        trackEvent("section-reached", { section: cur.dataset.name });
      }
      document.documentElement.style.setProperty("--amb", cur.dataset.seg);
      segs.forEach((s) => s.link?.classList.toggle("on", s.el === cur));
    }
  }

  // ---- Giant outline words: fit each to ~92% of the viewport width ---------
  const bgWords = [...document.querySelectorAll(".bg-word")];
  function fitWords() {
    for (const el of bgWords) {
      el.style.fontSize = "100px";
      const w = el.offsetWidth || 1;
      el.style.fontSize = Math.min((100 * innerWidth * 0.92) / w, innerHeight * 0.62) + "px";
    }
  }

  // ---- Pointer: mouse parallax, card tilt, outline glow --------------------
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  document.documentElement.classList.toggle("no-hover", !fine);
  const ptr = { x: 0, y: 0, in: false };
  if (fine && !reduced) {
    addEventListener(
      "pointermove",
      (e) => {
        ptr.x = e.clientX;
        ptr.y = e.clientY;
        ptr.in = true;
      },
      { passive: true },
    );
    document.documentElement.addEventListener("pointerleave", () => (ptr.in = false));
  }
  const rootStyle = document.documentElement.style;
  const tilts = [...document.querySelectorAll("[data-tilt]")].map((el) => ({ el, rx: 0, ry: 0, sh: 0 }));
  const glows = [...document.querySelectorAll("[data-glow]")];
  const htl = document.querySelector("[data-htl]");
  const lerp = (a, b, k) => a + (b - a) * k;
  const LOOP_MS = 12000; // hero timeline playhead cycle
  let mx = 0;
  let my = 0;

  function motion(now) {
    const vw = innerWidth;
    const vh = innerHeight;

    // Whole-page mouse parallax (-1..1), eased.
    mx = lerp(mx, ptr.in ? (ptr.x / vw) * 2 - 1 : 0, 0.08);
    my = lerp(my, ptr.in ? (ptr.y / vh) * 2 - 1 : 0, 0.08);
    rootStyle.setProperty("--mx", mx.toFixed(3));
    rootStyle.setProperty("--my", my.toFixed(3));

    // Cards turn to face the cursor; a sheen follows it across the card.
    for (const t of tilts) {
      const r = t.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      let tx = 0;
      let ty = 0;
      let sh = 0;
      if (ptr.in && !t.el.classList.contains("focus")) {
        const dx = clamp((ptr.x - (r.left + r.width / 2)) / (vw / 2), -1, 1);
        const dy = clamp((ptr.y - (r.top + r.height / 2)) / (vh / 2), -1, 1);
        tx = -dy * 7;
        ty = dx * 9;
        const inside = ptr.x > r.left && ptr.x < r.right && ptr.y > r.top && ptr.y < r.bottom;
        sh = inside ? 1 : 0.3 * (1 - Math.min(1, Math.hypot(dx, dy)));
        t.el.style.setProperty("--sx", (ptr.x - r.left).toFixed(0) + "px");
        t.el.style.setProperty("--sy", (ptr.y - r.top).toFixed(0) + "px");
      }
      t.rx = lerp(t.rx, tx, 0.1);
      t.ry = lerp(t.ry, ty, 0.1);
      t.sh = lerp(t.sh, sh, 0.1);
      t.el.style.setProperty("--rx", t.rx.toFixed(2) + "deg");
      t.el.style.setProperty("--ry", t.ry.toFixed(2) + "deg");
      t.el.style.setProperty("--sh", t.sh.toFixed(3));
    }

    // Outline words: glow mask centred on the cursor, in each word's own space.
    if (ptr.in) {
      for (const el of glows) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) continue;
        el.style.setProperty("--gx", (ptr.x - r.left).toFixed(0) + "px");
        el.style.setProperty("--gy", (ptr.y - r.top).toFixed(0) + "px");
      }
    }

    // Hero timeline: playhead sweeps, edits appear as it passes, then fade/reset.
    // On scroll it rises faster than the page, so its front edge wipes up the
    // screen on the way into the next section.
    if (htl && scrollY < innerHeight * 1.5) {
      htl.style.setProperty("--rise", (-0.35 * scrollY).toFixed(1) + "px");
      const t = (now % LOOP_MS) / LOOP_MS;
      const fade = t < 0.04 ? t / 0.04 : t > 0.9 ? 1 - (t - 0.9) / 0.1 : 1;
      htl.style.setProperty("--hp", clamp(t / 0.86).toFixed(4));
      htl.style.setProperty("--fade", fade.toFixed(3));
    }
  }

  // ---- One loop: Lenis → scroll-driven state → pointer motion ------------
  let lastY = -1;
  let dirty = true;
  function frame(now) {
    lenis?.raf(now);
    if (dirty || scrollY !== lastY) {
      lastY = scrollY;
      dirty = false;
      update();
    }
    if (!reduced) motion(now);
    requestAnimationFrame(frame);
  }
  const relayout = () => {
    buildScrubber();
    fitWords();
    dirty = true;
  };
  addEventListener("resize", relayout);
  addEventListener("load", relayout);
  document.fonts?.ready.then(relayout);
  buildScrubber();
  fitWords();
  update();
  requestAnimationFrame(frame);

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

  // ---- Launch video: click to play in focus ------------------------------
  // The card flies from its spot in the hero to the centre of the screen over
  // a dimmed backdrop (page scroll locked). Clicking the backdrop or pressing
  // Esc flies it back and pauses. The card is moved to <body> while focused,
  // because the hero's perspective/transforms would trap position: fixed.
  const launch = document.getElementById("launch");
  const playBtn = document.querySelector("[data-play]");
  const card = launch.closest(".video-card");
  const FLY = { duration: reduced ? 0 : 650, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };

  const scrim = document.createElement("div");
  scrim.className = "video-scrim";
  scrim.setAttribute("aria-hidden", "true");
  document.body.append(scrim);

  const placeholder = document.createElement("div");
  placeholder.className = "video-card video-ph";
  placeholder.setAttribute("aria-hidden", "true");

  let focused = false;
  let busy = false;

  function targetRect() {
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const w = Math.min(vw * 0.9, vh * 0.86 * (3 / 2), 1500);
    const h = w * (2 / 3);
    return { left: (vw - w) / 2, top: (vh - h) / 2, width: w, height: h };
  }

  function placeFixed(r) {
    Object.assign(card.style, {
      left: r.left + "px",
      top: r.top + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
  }

  // Animate from rect `from` to the card's current fixed geometry `to`.
  function fly(from, to) {
    const s = from.width / to.width;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const anim = card.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }],
      FLY,
    );
    // `finished` can stall when the page isn't painting (background tab), so
    // never wait on it longer than the animation itself.
    const timeout = new Promise((r) => setTimeout(r, FLY.duration + 120));
    return Promise.race([anim.finished.catch(() => {}), timeout]).then(() => anim.finish());
  }

  function lockScroll(on) {
    const gap = innerWidth - document.documentElement.clientWidth;
    document.documentElement.classList.toggle("scroll-locked", on);
    if (lenis) on ? lenis.stop() : lenis.start();
    document.body.style.paddingRight = on && gap > 0 ? gap + "px" : "";
  }

  async function openVideo() {
    if (focused || busy) return;
    busy = true;
    const from = card.getBoundingClientRect();
    card.replaceWith(placeholder);
    document.body.append(card);
    card.classList.add("focus");
    const to = targetRect();
    placeFixed(to);
    lockScroll(true);
    scrim.classList.add("on");
    playBtn.classList.add("hidden");
    launch.muted = false;
    launch.controls = true;
    launch.play().catch(() => {});
    focused = true;
    await fly(from, to);
    launch.focus({ preventScroll: true });
    busy = false;
  }

  async function closeVideo() {
    if (!focused || busy) return;
    busy = true;
    launch.pause();
    launch.controls = false;
    scrim.classList.remove("on");
    const from = card.getBoundingClientRect();
    const to = placeholder.getBoundingClientRect();
    placeFixed(to);
    await fly(from, to);
    card.classList.remove("focus");
    card.removeAttribute("style");
    placeholder.replaceWith(card);
    lockScroll(false);
    playBtn.classList.remove("hidden");
    playBtn.focus({ preventScroll: true });
    focused = false;
    busy = false;
  }

  playBtn.addEventListener("click", () => {
    trackEvent("video-play");
    openVideo();
  });
  launch.addEventListener("ended", () => trackEvent("video-complete"));
  scrim.addEventListener("click", closeVideo);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeVideo();
  });
  addEventListener("resize", () => {
    if (focused && !busy) placeFixed(targetRect());
  });
})();
