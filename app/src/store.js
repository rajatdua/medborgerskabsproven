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

    async function load() {
      let db = null;
      let uid = null;
      try {
        db = await getDb();
        const user = db && (await getUser());
        uid = user && (await user.id());
      } catch (e) {
        db = null;
      }
      if (!db || !uid) return setStatus("local");
      cloud = db.collection(`data/users/${uid}`);
      setStatus("syncing");
      try {
        const snaps = await Promise.all(DOCS.map((d) => cloud.doc(d).get()));
        const found = {};
        snaps.forEach((snap, i) => {
          if (snap.exists) found[DOCS[i]] = snap.data().v;
        });
        let remote = null;
        if (Object.keys(found).length) {
          const base = defaults();
          remote = {};
          for (const d of DOCS) remote[d] = found[d] === undefined ? base[d] : found[d];
        }
        const { state: merged, remoteStale } = Merge.mergeState(state, remote);
        state = merged;
        DOCS.forEach(writeLocal);
        remoteStale.forEach((d) => dirty.add(d));
        notify();
        await flush();
      } catch (e) {
        setStatus("offline");
      }
    }

    function update(doc, fn) {
      state = { ...state, [doc]: fn(state[doc]) };
      writeLocal(doc);
      dirty.add(doc);
      notify();
      if (cloud) {
        clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
      }
    }

    // Writes run one at a time so the same doc never has overlapping writes.
    function flush() {
      clearTimeout(timer);
      timer = null;
      writing = writing.then(async () => {
        if (!cloud || !dirty.size) return;
        setStatus("syncing");
        for (const doc of [...dirty]) {
          dirty.delete(doc);
          try {
            await cloud.doc(doc).set({ v: state[doc] });
          } catch (e) {
            dirty.add(doc);
            setStatus("offline");
            return;
          }
        }
        setStatus("synced");
      });
      return writing;
    }

    function reset() {
      state = defaults();
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
