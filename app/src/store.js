// Progress persistence: localStorage cache + private cloud docs (data/users/<id>/<doc>).
(function (root) {
  const Merge = root.Merge || require("./merge.js");
  const Rewards = root.Rewards || require("./rewards.js");

  const PREFIX = "kob:v1:";
  const DOCS = Merge.DOCS;

  function defaults() {
    return {
      srs: {},
      summary: Rewards.emptySummary(),
      history: [],
      settings: { lang: "da", sound: true, updatedAt: 0 },
    };
  }

  function createStore({ storage, getDb, getUser, debounceMs = 3000 }) {
    const listeners = [];
    const dirty = new Set();
    let state = readLocal();
    let cloud = null; // collection ref once signed in
    let timer = null;
    let writing = Promise.resolve();

    const store = {
      status: "local",
      get state() {
        return state;
      },
      load,
      update,
      flush,
      reset,
      onChange: (fn) => listeners.push(fn),
    };

    function notify() {
      for (const fn of listeners) fn(store);
    }

    function setStatus(s) {
      if (store.status !== s) {
        store.status = s;
        notify();
      }
    }

    function readLocal() {
      const s = defaults();
      for (const doc of DOCS) {
        try {
          const raw = storage && storage.getItem(PREFIX + doc);
          if (raw) s[doc] = doc === "summary" ? { ...s.summary, ...JSON.parse(raw) } : JSON.parse(raw);
        } catch (e) {
          // Storage blocked or corrupt: keep defaults for this doc.
        }
      }
      return s;
    }

    function writeLocal(doc) {
      try {
        if (storage) storage.setItem(PREFIX + doc, JSON.stringify(state[doc]));
      } catch (e) {
        // Storage blocked or full: the cloud copy still gets it.
      }
    }

    // Cloud docs are {v: value, epoch}. A reset bumps the epoch; a newer epoch
    // wins wholesale, equal epochs merge, older ones are overwritten.
    let conn = null; // {uid, db} once signed in
    let epoch = readEpoch();

    function readEpoch() {
      try {
        return Number(storage && storage.getItem(PREFIX + "epoch")) || 0;
      } catch (e) {
        return 0;
      }
    }

    function writeEpoch() {
      try {
        if (storage) storage.setItem(PREFIX + "epoch", String(epoch));
      } catch (e) {
        // Storage blocked: the epoch still lives in memory for this visit.
      }
    }

    async function load() {
      try {
        const db = await getDb();
        const user = db && (await getUser());
        const uid = user && (await user.id());
        if (db && uid) conn = { db, uid };
      } catch (e) {
        conn = null;
      }
      if (!conn) return setStatus("local");
      return flush();
    }

    // Fetch all docs and fold them into local state. Sets `cloud` only on success.
    async function pull() {
      const col = conn.db.collection(`data/users/${conn.uid}`);
      const snaps = await Promise.all(DOCS.map((d) => col.doc(d).get()));
      const found = {};
      let remoteEpoch = 0;
      snaps.forEach((snap, i) => {
        if (!snap.exists) return;
        const body = snap.data();
        found[DOCS[i]] = body.v;
        remoteEpoch = Math.max(remoteEpoch, body.epoch || 0);
      });
      const base = defaults();
      const remote = {};
      for (const d of DOCS) remote[d] = found[d] === undefined ? base[d] : found[d];
      if (remoteEpoch > epoch) {
        state = remote;
        epoch = remoteEpoch;
        writeEpoch();
        dirty.clear();
      } else if (remoteEpoch < epoch || !Object.keys(found).length) {
        DOCS.forEach((d) => dirty.add(d));
      } else {
        const { state: merged, remoteStale } = Merge.mergeState(state, remote);
        state = merged;
        remoteStale.forEach((d) => dirty.add(d));
      }
      DOCS.forEach(writeLocal);
      cloud = col;
      notify();
    }

    // Write dirty docs, merging with whatever another device wrote meanwhile.
    async function push(retried) {
      for (const doc of [...dirty]) {
        const ref = cloud.doc(doc);
        const snap = await ref.get();
        const body = snap.exists ? snap.data() : null;
        const remoteEpoch = body ? body.epoch || 0 : -1;
        if (remoteEpoch > epoch) {
          // Another device reset progress: adopt its state, then retry once.
          await pull();
          if (!retried) return push(true);
          return;
        }
        const value = body && remoteEpoch === epoch ? Merge.mergeDoc(doc, state[doc], body.v) : state[doc];
        if (JSON.stringify(value) !== JSON.stringify(state[doc])) {
          state = { ...state, [doc]: value };
          writeLocal(doc);
          notify();
        }
        await ref.set({ v: value, epoch });
        dirty.delete(doc);
      }
    }

    function update(doc, fn) {
      state = { ...state, [doc]: fn(state[doc]) };
      writeLocal(doc);
      dirty.add(doc);
      notify();
      if (conn) {
        clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
      }
    }

    // One sync at a time; a failed sync keeps docs dirty for the next try.
    function flush() {
      clearTimeout(timer);
      timer = null;
      writing = writing.then(async () => {
        if (!conn) return;
        setStatus("syncing");
        try {
          if (!cloud) await pull();
          await push(false);
          setStatus("synced");
        } catch (e) {
          setStatus("offline");
        }
      });
      return writing;
    }

    function reset() {
      state = defaults();
      epoch = Math.max(epoch + 1, Date.now());
      writeEpoch();
      DOCS.forEach((d) => {
        writeLocal(d);
        dirty.add(d);
      });
      notify();
      return flush();
    }

    return store;
  }

  const api = { createStore, defaults };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Store = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
