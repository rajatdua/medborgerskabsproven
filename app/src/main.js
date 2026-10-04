// Boot: render from the local cache at once, then sync with the private cloud copy.
(function (root) {
  const data = JSON.parse(document.getElementById("data").textContent);

  let storage = null;
  try {
    storage = root.localStorage;
  } catch (e) {
    storage = null;
  }

  const use = (name) => (root.claude && root.claude.use ? root.claude.use(name) : Promise.resolve(null));
  const store = root.Store.createStore({
    storage,
    getDb: () => use("db"),
    getUser: () => use("user"),
  });

  const ui = root.UI.createUI({ el: document.getElementById("app"), data, store });
  ui.render();
  store.load().then(() => ui.render());

  // Save pending progress when the tab is hidden or closed.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") store.flush();
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
