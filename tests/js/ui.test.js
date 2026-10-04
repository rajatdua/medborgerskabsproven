// Drives ui.js through its click handler with a fake element (no DOM library).
const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.SRS = require("../../app/src/srs.js");
globalThis.Rewards = require("../../app/src/rewards.js");
globalThis.Engine = require("../../app/src/engine.js");
globalThis.I18n = require("../../app/src/i18n.js");
globalThis.FX = { sound() {}, setMuted() {}, confetti() {}, toast() {} };
globalThis.document = { documentElement: {}, addEventListener() {} };
globalThis.window = { scrollTo() {} };
const Store = require("../../app/src/store.js");
const UI = require("../../app/src/ui.js");
const { makeData } = require("./fixtures.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WARN = "Fra før 2024 – i dag er det Kongen (Frederik 10.), der fx holder nytårstalen.";

function harness() {
  const data = makeData();
  data.exam.find((x) => x.id === "e-2025-05-1").w = WARN;
  let now = Date.UTC(2026, 9, 4, 12);
  const el = {
    innerHTML: "",
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector() { return null; },
  };
  const store = Store.createStore({ storage: null, getDb: async () => null, getUser: async () => null });
  const ui = UI.createUI({ el, data, store, clock: () => now });
  ui.render();
  const click = (dataset) => el.listeners.click({ target: { closest: () => ({ dataset, focus() {} }) } });
  return { el, click, advance: (ms) => (now += ms), sessions: [] };
}

test("quitting during the exam answer flash does not throw", async () => {
  const h = harness();
  h.click({ act: "start", mode: "mock" });
  h.click({ act: "answer", i: "0" });
  h.click({ act: "home" });
  await sleep(300);
  assert.match(h.el.innerHTML, /Prøveparathed/);
});

test("a stale flash from an old exam cannot end a new one", async () => {
  const h = harness();
  h.click({ act: "start", mode: "paper", paper: "2025-05" });
  for (let i = 0; i < 24; i++) {
    h.click({ act: "answer", i: "0" });
    await sleep(240);
  }
  h.click({ act: "answer", i: "0" });
  h.click({ act: "home" });
  h.click({ act: "start", mode: "paper", paper: "2025-11" });
  await sleep(300);
  assert.match(h.el.innerHTML, /Spørgsmål 1 af 25/);
  assert.doesNotMatch(h.el.innerHTML, /class="stamp/);
  h.click({ act: "home" });
});

test("exam results show warnings for outdated questions", async () => {
  const h = harness();
  h.click({ act: "start", mode: "paper", paper: "2025-05" });
  h.advance(1800001);
  await sleep(300);
  assert.match(h.el.innerHTML, /class="stamp/);
  assert.ok(h.el.innerHTML.includes(WARN));
});
