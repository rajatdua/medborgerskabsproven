const test = require("node:test");
const assert = require("node:assert/strict");
const I18n = require("../../app/src/i18n.js");
const Rewards = require("../../app/src/rewards.js");

test("da and en have identical key sets", () => {
  const da = Object.keys(I18n.STRINGS.da).sort();
  const en = Object.keys(I18n.STRINGS.en).sort();
  assert.deepEqual(en, da);
});

test("no empty strings", () => {
  for (const lang of ["da", "en"]) {
    for (const [k, v] of Object.entries(I18n.STRINGS[lang])) assert.ok(v.trim(), `${lang}.${k}`);
  }
});

test("interpolates vars", () => {
  assert.equal(I18n.t("result.scoreOf", "da", { score: 21, total: 25 }), "21 ud af 25");
  assert.equal(I18n.t("result.scoreOf", "en", { score: 21, total: 25 }), "21 out of 25");
});

test("falls back to da, then to the key", () => {
  const saved = I18n.STRINGS.en["result.scoreOf"];
  delete I18n.STRINGS.en["result.scoreOf"];
  assert.equal(I18n.t("result.scoreOf", "en", { score: 1, total: 2 }), "1 ud af 2");
  I18n.STRINGS.en["result.scoreOf"] = saved;
  assert.equal(I18n.t("no.such.key", "en"), "no.such.key");
});

test("every rank and achievement has a name", () => {
  Rewards.RANKS.forEach((rank, i) => assert.equal(I18n.STRINGS.da[`rank.${i}`], rank));
  for (const { id } of Rewards.ACHIEVEMENTS) {
    assert.ok(I18n.STRINGS.da[`ach.${id}.name`], id);
    assert.ok(I18n.STRINGS.da[`ach.${id}.desc`], id);
  }
});
