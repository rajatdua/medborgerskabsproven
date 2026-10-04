// Small fake dataset in the shape of content/data.json, plus a seeded RNG.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeData() {
  const exam = [];
  const papers = {};
  for (const paper of ["2025-05", "2025-11", "2026-06"]) {
    papers[paper] = [];
    for (let n = 1; n <= 25; n++) {
      const id = `e-${paper}-${n}`;
      exam.push({ id, q: `Spørgsmål ${paper} ${n}?`, o: ["A-svar", "B-svar", "C-svar"], a: n % 3, e: [paper], f: 1 });
      papers[paper].push(id);
    }
  }
  const cards = [];
  for (let i = 0; i < 12; i++) cards.push({ id: `c-big-${i}`, q: `Stort emne ${i}?`, a: `Svar nummer ${i}${"x".repeat(i)}`, t: "FA01_Big" });
  cards.push({ id: "c-small-0", q: "Lille 0?", a: "Eneste svar", t: "FA02_Small" });
  cards.push({ id: "c-small-1", q: "Lille 1?", a: "Andet svar", t: "FA02_Small" });
  for (let i = 0; i < 3; i++) cards.push({ id: `c-same-${i}`, q: `Ens ${i}?`, a: "Ja.", t: "FA03_Same" });
  const topics = [
    { t: "FA01_Big", da: "Big" },
    { t: "FA02_Small", da: "Small" },
    { t: "FA03_Same", da: "Same" },
  ];
  return { exam, papers, cards, topics, en: {} };
}

module.exports = { seeded, makeData };
