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
    if (a > 0.45) end++;
    else if (a < 0.05) center++;
    else if (a > 0.13 && a < 0.19) valley++;
  }
  return { end, center, valley };
}

const N = 20000;

const u = bucketCounts("uniform", N);
assert(Math.abs(u.end - u.center) / u.center < 0.3, `uniform roughly flat (end=${u.end} center=${u.center} valley=${u.valley})`);

function farEndsFrac(dist, n) {
  let far = 0;
  for (let i = 0; i < n; i++) if (Math.abs(WL.sampleTargetX(dist)) > 0.4) far++;
  return far / n;
}

const fracU = farEndsFrac("uniform", N);
const fracMild = farEndsFrac("mild", N);
const fracRec = farEndsFrac("recommended", N);
const fracStrong = farEndsFrac("strong", N);
assert(fracStrong > fracRec && fracRec > fracMild && fracMild > fracU,
  `far-ends fraction ordered strong>rec>mild>uniform (${[fracU, fracMild, fracRec, fracStrong].map((f) => (f * 100).toFixed(1) + "%").join(" > ")})`);
assert(fracRec > fracU + 0.05,
  `recommended far-ends clearly above uniform (${(fracRec * 100).toFixed(1)}% vs ${(fracU * 100).toFixed(1)}%)`);
assert(fracStrong > fracU + 0.10,
  `strong far-ends clearly above uniform (${(fracStrong * 100).toFixed(1)}% vs ${(fracU * 100).toFixed(1)}%)`);
console.log(`ok: far-ends fractions uniform=${(fracU * 100).toFixed(1)}% mild=${(fracMild * 100).toFixed(1)}% rec=${(fracRec * 100).toFixed(1)}% strong=${(fracStrong * 100).toFixed(1)}%`);

for (const [name, dist] of [["mild", "mild"], ["recommended", "recommended"], ["strong", "strong"]]) {
  const b = bucketCounts(dist, N);
  assert(b.end > b.center, `${name}: ends > center (${b.end} vs ${b.center})`);
  assert(b.center > b.valley, `${name}: center > valley (${b.center} vs ${b.valley})`);
  assert(b.end / b.valley > 1.3, `${name}: ends/valley ratio > 1.3 (${(b.end / b.valley).toFixed(2)})`);
  console.log(`ok: ${name} ratios end/valley=${(b.end / b.valley).toFixed(2)} center/valley=${(b.center / b.valley).toFixed(2)}`);
}

const t = WL.newTarget({ dist: "recommended" });
assert(t.center >= 0 && t.center <= 1000, "target center within [0,1000]");
assert(t.center - t.w4 >= -35 && t.center + t.w4 <= 1035, "4-point wedge always at least partially on bar");
assert(t.w4 === 35 && t.w3 === 80 && t.w2 === 130, "band widths unchanged");

console.log("DIST TEST PASSED");
process.exit(0);
