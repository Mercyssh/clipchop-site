// Feedback page: pick "Report a bug" or "Share your experience", fill the
// matching form, and it's submitted into a Google Form (responses land in a
// Google Sheet). Until the Google Forms are connected, submitting opens the
// visitor's email app with their message ready to send instead.

(() => {
  "use strict";

  // ---- Google Forms wiring --------------------------------------------------
  // For each form: `action` is the form's ".../formResponse" URL, and `entries`
  // maps each field below to that question's "entry.123456789" ID (from Google
  // Forms > ⋮ > Get pre-filled link). Leave `action` empty to use email instead.
  const FORMS = {
    bug: {
      action: "https://docs.google.com/forms/d/e/1FAIpQLSf8w8ND0tRpqVLPFPZePpmvISm5SdRa3cet-vjh7DNwuApzFg/formResponse",
      entries: { what: "entry.681896889", system: "entry.499225816", version: "entry.1704105593", email: "entry.1579896327" },
    },
    experience: {
      action: "https://docs.google.com/forms/d/e/1FAIpQLSdWSZTttjf04i7M4P4NId4CuPRbzmD5xueURxrX1ZwKLmJJRA/formResponse",
      entries: {
        system: "entry.1357206316",
        uses: "entry.2140714965",
        ease: "entry.1197438331",
        install: "entry.1874444806",
        hiccup: "entry.1666066808",
        features: "entry.940351146",
        frustrated: "entry.879756902",
        liked: "entry.1478304233",
        recommend: "entry.1730913536",
        source: "entry.1412409124",
        email: "entry.1523641838",
      },
      // Questions that use Google's built-in "Other" option: an answer of
      // "Other" must be sent as Google's special value instead.
      other: ["uses"],
    },
  };
  const CONTACT = "ima.omrane@gmail.com";

  // Labels for the email fallback.
  const LABELS = {
    what: "What happened",
    system: "System",
    version: "ClipChop version",
    email: "Email",
    uses: "Makes videos for",
    ease: "Ease of picking up (1-5)",
    install: "Install and first launch",
    hiccup: "Install hiccup",
    features: "Features used",
    frustrated: "Frustrating or missing",
    liked: "Liked most",
    recommend: "Would recommend (1-10)",
    source: "Found ClipChop via",
  };

  const track = (name, data) => {
    try {
      window.umami?.track(name, data);
    } catch {}
  };

  // ---- Pre-select the visitor's system --------------------------------------
  async function guessSystem() {
    const uad = navigator.userAgentData;
    const p = (uad?.platform ?? navigator.platform ?? "").toLowerCase();
    if (/android|iphone|ipad|ipod/i.test(navigator.userAgent)) return "";
    if (p.includes("win")) {
      // Windows 11 reports platformVersion 13+ through client hints.
      try {
        const { platformVersion } = await uad.getHighEntropyValues(["platformVersion"]);
        return parseInt(platformVersion, 10) >= 13 ? "Windows 11" : "Windows 10";
      } catch {
        return "";
      }
    }
    if (p.includes("linux")) return "Linux";
    return ""; // macOS: Apple Silicon vs Intel can't be told apart reliably
  }
  guessSystem().then((sys) => {
    if (sys) document.querySelectorAll("[data-os-select]").forEach((s) => (s.value = sys));
  });

  // ---- Step 1: choose a form --------------------------------------------------
  const cards = [...document.querySelectorAll("[data-pick]")];
  const forms = Object.fromEntries([...document.querySelectorAll("[data-form]")].map((f) => [f.dataset.form, f]));
  const thanks = document.querySelector("[data-thanks]");

  function pick(kind, { scroll = true } = {}) {
    if (!forms[kind]) return;
    cards.forEach((c) => c.setAttribute("aria-selected", String(c.dataset.pick === kind)));
    Object.entries(forms).forEach(([k, f]) => (f.hidden = k !== kind));
    thanks.hidden = true;
    history.replaceState(null, "", "#" + kind);
    if (scroll) forms[kind].scrollIntoView({ behavior: "smooth", block: "start" });
  }
  cards.forEach((c) =>
    c.addEventListener("click", () => {
      pick(c.dataset.pick);
      track("feedback-open", { type: c.dataset.pick });
    }),
  );
  const initial = location.hash.slice(1);
  if (forms[initial]) pick(initial, { scroll: false });

  // "Had a hiccup" reveals a follow-up question.
  const hiccup = document.querySelector("[data-if-hiccup]");
  document.querySelectorAll('input[name="install"]').forEach((r) =>
    r.addEventListener("change", () => (hiccup.hidden = r.value !== "Had a hiccup" || !r.checked)),
  );

  // ---- Step 2: submit -------------------------------------------------------
  function collect(form) {
    const out = {};
    for (const [k, v] of new FormData(form)) {
      if (k === "company" || !String(v).trim()) continue;
      if (k === "hiccup" && hiccup.hidden) continue;
      (out[k] ??= []).push(String(v).trim());
    }
    return out;
  }

  function emailFallback(kind, data) {
    const subject = kind === "bug" ? "ClipChop bug report" : "ClipChop feedback";
    const body = Object.entries(data)
      .map(([k, v]) => `${LABELS[k] ?? k}: ${v.join(", ")}`)
      .join("\n\n");
    location.href = `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function send(kind, data) {
    const cfg = FORMS[kind];
    const params = new URLSearchParams();
    for (const [k, values] of Object.entries(data)) {
      const id = cfg.entries[k];
      if (!id) continue;
      for (const v of values) {
        if (v === "Other" && cfg.other?.includes(k)) {
          params.append(id, "__other_option__");
          params.append(id + ".other_option_response", "Other");
        } else {
          params.append(id, v);
        }
      }
    }
    // Google Forms doesn't allow reading the response cross-origin; a network
    // error is the only failure we can see.
    await fetch(cfg.action, { method: "POST", mode: "no-cors", body: params });
  }

  Object.entries(forms).forEach(([kind, form]) => {
    const msg = form.querySelector("[data-msg]");
    const btn = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "";
      msg.classList.remove("err");

      // The bug form needs a description; the experience form needs anything at all.
      const required = form.querySelector("[required]");
      if (required && !required.value.trim()) {
        required.closest(".fld").classList.add("invalid");
        msg.textContent = "Please describe what happened.";
        msg.classList.add("err");
        required.focus();
        return;
      }
      const data = collect(form);
      const answered = Object.keys(data).filter((k) => k !== "system" && k !== "version");
      if (!answered.length) {
        msg.textContent = "Add at least one answer before sending.";
        msg.classList.add("err");
        return;
      }

      // Bots fill the hidden field; quietly pretend it worked.
      const bot = form.querySelector('[name="company"]').value;
      const viaForms = !!FORMS[kind].action;

      if (!bot) {
        if (viaForms) {
          btn.disabled = true;
          msg.textContent = "Sending…";
          try {
            await send(kind, data);
          } catch {
            btn.disabled = false;
            msg.innerHTML = `Couldn't send. Check your connection, or <a href="mailto:${CONTACT}">email me</a>.`;
            msg.classList.add("err");
            return;
          }
          btn.disabled = false;
        } else {
          emailFallback(kind, data);
        }
        track("feedback-submit", { type: kind, via: viaForms ? "form" : "email" });
      }

      form.reset();
      guessSystem().then((sys) => sys && form.querySelectorAll("[data-os-select]").forEach((s) => (s.value = sys)));
      hiccup.hidden = true;
      msg.textContent = "";
      form.hidden = true;
      thanks.querySelector("[data-thanks-text]").textContent = viaForms
        ? kind === "bug"
          ? "Your bug report is in. If you left an email, I'll get back to you."
          : "Your feedback is in. It really helps shape what ClipChop does next."
        : "Your email app should have opened with your message ready. Just hit send.";
      thanks.hidden = false;
      cards.forEach((c) => c.setAttribute("aria-selected", "false"));
      history.replaceState(null, "", location.pathname);
      thanks.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    form.addEventListener("input", (e) => e.target.closest(".fld")?.classList.remove("invalid"));
  });

  document.querySelector("[data-again]").addEventListener("click", () => {
    thanks.hidden = true;
    scrollTo({ top: 0, behavior: "smooth" });
  });
})();
