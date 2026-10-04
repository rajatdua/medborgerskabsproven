// Sound effects, confetti and toasts. Everything here is optional polish:
// it no-ops quietly when the browser lacks the API or the user prefers reduced motion.
(function (root) {
  const doc = root.document;
  let audio = null;
  let muted = false;

  const reducedMotion = () =>
    !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function ctx() {
    if (!audio) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  function tone(freq, start, dur, type = "sine", gain = 0.12) {
    const ac = ctx();
    if (!ac) return;
    const t0 = ac.currentTime + start;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const SOUNDS = {
    right: () => { tone(660, 0, 0.12); tone(990, 0.08, 0.18); },
    wrong: () => { tone(180, 0, 0.22, "square", 0.05); },
    level: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle")); },
    pass: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, "triangle")); },
    fail: () => { tone(330, 0, 0.25, "triangle"); tone(262, 0.2, 0.4, "triangle"); },
  };

  function sound(name) {
    if (muted || !SOUNDS[name]) return;
    try {
      SOUNDS[name]();
    } catch (e) {
      // Audio unavailable; stay silent.
    }
  }

  function setMuted(value) {
    muted = value;
  }

  function confetti() {
    try {
      burst();
    } catch (e) {
      // No canvas drawing available; skip the celebration.
    }
  }

  function burst() {
    const canvas = doc && doc.getElementById("confetti");
    if (!canvas || reducedMotion() || !canvas.getContext) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const dpr = root.devicePixelRatio || 1;
    const w = (canvas.width = root.innerWidth * dpr);
    const h = (canvas.height = root.innerHeight * dpr);
    const styles = root.getComputedStyle(doc.documentElement);
    const colors = [styles.getPropertyValue("--red").trim() || "#c8102e", "#ffffff", styles.getPropertyValue("--gold").trim() || "#f2b63d"];
    const parts = Array.from({ length: 140 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 18 * dpr,
      vy: (-Math.random() * 16 - 6) * dpr,
      s: (6 + Math.random() * 6) * dpr,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const start = performance.now();
    function frame(t) {
      const elapsed = t - start;
      g.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.5 * dpr;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.fillStyle = p.c;
        g.strokeStyle = "rgba(0,0,0,0.15)";
        g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        g.strokeRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        g.restore();
      }
      if (elapsed < 1800) requestAnimationFrame(frame);
      else g.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(frame);
  }

  function toast(html) {
    const box = doc && doc.getElementById("toasts");
    if (!box) return;
    const el = doc.createElement("div");
    el.className = "toast";
    el.innerHTML = html;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  const api = { sound, setMuted, confetti, toast };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FX = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
