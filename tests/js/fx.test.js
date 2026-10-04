const test = require("node:test");
const assert = require("node:assert/strict");

test("confetti never throws when the canvas cannot draw", () => {
  const canvas = { getContext() { throw new Error("Not implemented"); } };
  globalThis.document = { getElementById: () => canvas, documentElement: {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.innerWidth = 400;
  globalThis.innerHeight = 800;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  delete require.cache[require.resolve("../../app/src/fx.js")];
  const FX = require("../../app/src/fx.js");
  try {
    assert.doesNotThrow(() => FX.confetti());
  } finally {
    delete globalThis.document;
    delete globalThis.matchMedia;
  }
});

test("sound never throws without an AudioContext", () => {
  const FX = require("../../app/src/fx.js");
  assert.doesNotThrow(() => FX.sound("right"));
});
