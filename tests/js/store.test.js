const test = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../../app/src/store.js");
const R = require("../../app/src/rewards.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

const throwingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
};

function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const writes = [];
  const api = {
    fail: false,
    writes,
    docs,
    collection(path) {
      return {
        doc(id) {
          const key = `${path}/${id}`;
          return {
            async get() {
              const body = docs.get(key);
              return { exists: body !== undefined, data: () => body };
            },
            async set(body) {
              if (api.fail) throw { code: "unavailable" };
              writes.push(key);
              docs.set(key, JSON.parse(JSON.stringify(body)));
            },
          };
        },
      };
    },
  };
  return api;
}

const fakeUser = { id: async () => "u_me" };

test("works when localStorage throws", async () => {
  const store = Store.createStore({ storage: throwingStorage, getDb: async () => null, getUser: async () => null });
  assert.deepEqual(store.state.summary, R.emptySummary());
  store.update("summary", (s) => ({ ...s, xp: 10 }));
  assert.equal(store.state.summary.xp, 10);
  await store.load();
  assert.equal(store.status, "local");
});

test("status local when db is null", async () => {
  const store = Store.createStore({ storage: memoryStorage(), getDb: async () => null, getUser: async () => fakeUser });
  await store.load();
  assert.equal(store.status, "local");
});

test("reads local state written by an earlier session", () => {
  const storage = memoryStorage();
  const a = Store.createStore({ storage, getDb: async () => null, getUser: async () => null });
  a.update("settings", (s) => ({ ...s, lang: "en" }));
  const b = Store.createStore({ storage, getDb: async () => null, getUser: async () => null });
  assert.equal(b.state.settings.lang, "en");
});

test("load merges remote and writes back only stale docs", async () => {
  const remoteSummary = { ...R.emptySummary(), xp: 900, lastDay: "2026-10-03", streak: 4 };
  const db = fakeDb({
    "data/users/u_me/summary": { v: remoteSummary },
    "data/users/u_me/srs": { v: { e1: { b: 3, d: 5, t: 50, s: 3, p: false } } },
  });
  const storage = memoryStorage();
  const seed = Store.createStore({ storage, getDb: async () => null, getUser: async () => null });
  seed.update("srs", () => ({ e1: { b: 1, d: 1, t: 10, s: 1, p: false }, e2: { b: 2, d: 2, t: 20, s: 2, p: false } }));

  const store = Store.createStore({ storage, getDb: async () => db, getUser: async () => fakeUser });
  await store.load();
  assert.equal(store.status, "synced");
  assert.equal(store.state.summary.xp, 900);
  assert.equal(store.state.srs.e1.b, 3);
  assert.equal(store.state.srs.e2.b, 2);
  assert.deepEqual(db.writes.sort(), ["data/users/u_me/srs"]);
});

test("debounces cloud writes", async () => {
  const db = fakeDb();
  const store = Store.createStore({ storage: memoryStorage(), getDb: async () => db, getUser: async () => fakeUser, debounceMs: 20 });
  await store.load();
  db.writes.length = 0;
  store.update("summary", (s) => ({ ...s, xp: 1 }));
  store.update("summary", (s) => ({ ...s, xp: 2 }));
  store.update("summary", (s) => ({ ...s, xp: 3 }));
  await sleep(60);
  assert.deepEqual(db.writes, ["data/users/u_me/summary"]);
  assert.equal(db.docs.get("data/users/u_me/summary").v.xp, 3);
});

test("flush writes immediately", async () => {
  const db = fakeDb();
  const store = Store.createStore({ storage: memoryStorage(), getDb: async () => db, getUser: async () => fakeUser, debounceMs: 10000 });
  await store.load();
  db.writes.length = 0;
  store.update("history", (h) => [{ date: 1, score: 20, mode: "mock" }, ...h]);
  await store.flush();
  assert.deepEqual(db.writes, ["data/users/u_me/history"]);
  assert.deepEqual(db.docs.get("data/users/u_me/history").v, [{ date: 1, score: 20, mode: "mock" }]);
});

test("failed cloud write keeps the doc dirty and reports offline", async () => {
  const db = fakeDb();
  const store = Store.createStore({ storage: memoryStorage(), getDb: async () => db, getUser: async () => fakeUser, debounceMs: 10000 });
  await store.load();
  db.fail = true;
  store.update("summary", (s) => ({ ...s, xp: 7 }));
  await store.flush();
  assert.equal(store.status, "offline");
  db.fail = false;
  db.writes.length = 0;
  await store.flush();
  assert.deepEqual(db.writes, ["data/users/u_me/summary"]);
  assert.equal(store.status, "synced");
});

test("onChange fires on update", () => {
  const store = Store.createStore({ storage: memoryStorage(), getDb: async () => null, getUser: async () => null });
  let calls = 0;
  store.onChange(() => calls++);
  store.update("summary", (s) => s);
  assert.equal(calls, 1);
});
