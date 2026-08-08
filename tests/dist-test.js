const path = require("path");
const WL = require(path.join(__dirname, "..", "game.js"));

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

function bucketCounts(dist, n) {
  let end = 0, center = 0, valley = 0;
  for (let i = 0; i < n; i++) {
    const x = WL.sampleTargetX(dist);
    const a = Math.abs(x);
    if (a > 0.9) end++;
    else if (a < 0.1) center++;
    else if (a > 0.65 && a < 0.75) valley++;
  }
  return { end, center, valley };
}

const N = 20000;

const u = bucketCounts("uniform", N);
assert(Math.abs(u.end - u.center) / u.center < 0.3, `uniform roughly flat (end=${u.end} center=${u.center} valley=${u.valley})`);

for (const [name, dist] of [["mild", "mild"], ["recommended", "recommended"], ["strong", "strong"]]) {
  const b = bucketCounts(dist, N);
  assert(b.end > b.center, `${name}: ends > center (${b.end} vs ${b.center})`);
  assert(b.center > b.valley, `${name}: center > valley (${b.center} vs ${b.valley})`);
  assert(b.end / b.valley > 1.3, `${name}: ends/valley ratio > 1.3 (${(b.end / b.valley).toFixed(2)})`);
  console.log(`ok: ${name} ratios end/valley=${(b.end / b.valley).toFixed(2)} center/valley=${(b.center / b.valley).toFixed(2)}`);
}

const t = WL.newTarget({ dist: "recommended" });
assert(t.center >= 150 && t.center <= 850, "target center within allowed range");
assert(t.w4 === 35 && t.w3 === 80 && t.w2 === 130, "band widths unchanged");

console.log("DIST TEST PASSED");
process.exit(0);
