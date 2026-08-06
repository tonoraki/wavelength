const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/home/carnot/code/vibing/wavelength/tests/node_modules/jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const dom = new JSDOM(html, {
  url: "file://" + path.join(ROOT, "index.html"),
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true
});
const { window } = dom;
const doc = window.document;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function click(id) {
  const el = typeof id === "string" ? doc.getElementById(id) : id;
  if (!el) throw new Error("missing #" + id);
  el.dispatchEvent(new window.Event("click", { bubbles: true }));
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

async function pickFile(name, content, inputId) {
  const input = doc.getElementById(inputId || "file-deck");
  const f = new window.File([content], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(120);
}

(async function () {
  await sleep(400);
  assert(doc.getElementById("setup-modal").className.indexOf("hidden") === -1, "setup modal shown initially");
  assert(doc.getElementById("conn-badge").textContent.indexOf("本地模式") !== -1, "local mode badge shown");
  assert(doc.getElementById("title-main").textContent === "WAVELENGTH", "default game title");

  await pickFile("my.json", JSON.stringify({
    name: "测试题库",
    cards: [["甲左", "甲右"], ["单1", "单2", "双1", "双2"]]
  }));
  assert(doc.getElementById("deck-info").textContent.indexOf("测试题库 · 2 张卡") !== -1, "JSON deck loaded");

  await pickFile("bad.json", '{ "cards": [["只有", "一半", "四个"]] }');
  assert(doc.getElementById("deck-msg").className.indexOf("err") !== -1, "bad JSON shows error");
  assert(doc.getElementById("deck-info").textContent.indexOf("测试题库") !== -1, "failed load keeps previous deck");

  await pickFile("my.yaml", "# 注释\n- [甲, 乙]\n- [丙, 丁, 戊, 己]\n");
  assert(doc.getElementById("deck-info").textContent.indexOf("my · 2 张卡") !== -1, "YAML deck loaded");

  await pickFile("names.json", JSON.stringify({ gameName: "猜心", gameTitle: "GUESSY", teamDefaultA: "蓝左", teamDefaultB: "粉右" }), "file-names");
  assert(doc.getElementById("title-main").textContent === "GUESSY", "custom game title applied");
  assert(doc.getElementById("input-nameA").value === "蓝左", "custom team default applied");

  await pickFile("bad.yaml", "hello world\n");
  assert(doc.getElementById("deck-msg").className.indexOf("err") !== -1, "bad YAML shows error");

  doc.getElementById("input-nameA").value = "蓝队";
  doc.getElementById("input-nameB").value = "粉队";
  doc.getElementById("select-first").value = "A";
  click("btn-start");

  assert(doc.getElementById("setup-modal").className.indexOf("hidden") !== -1, "setup modal closed");
  assert(doc.getElementById("scoreA").textContent === "0", "A starts at 0");
  assert(doc.getElementById("scoreB").textContent === "1", "B starts at 1");
  assert(doc.getElementById("hint").textContent.indexOf("查看目标") !== -1, "psychic phase hint");

  const sides = doc.getElementById("sides").children;
  assert(sides.length >= 1 && sides.length <= 2, "card rendered");

  click(doc.getElementById("controls").children[0]);
  assert(doc.getElementById("screen").className.indexOf("open") !== -1, "screen opened for psychic");
  click(doc.getElementById("controls").children[0]);
  assert(doc.getElementById("screen").className.indexOf("open") === -1, "screen closed after psychic done");
  assert(doc.getElementById("hint").textContent.indexOf("拖动金色拨杆") !== -1, "dial phase");

  const interact = doc.getElementById("interact");
  const axis = doc.getElementById("axis");
  axis.getBoundingClientRect = () => ({ left: 0, width: 1000 });
  const PE = window.PointerEvent || window.MouseEvent;
  interact.dispatchEvent(new PE("pointerdown", { clientX: 750, pointerId: 1, bubbles: true }));
  interact.dispatchEvent(new PE("pointermove", { clientX: 750, pointerId: 1, bubbles: true }));
  interact.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
  assert(doc.getElementById("dial").style.left !== "50%", "dial moved to " + doc.getElementById("dial").style.left);

  click("btn-lock");
  assert(doc.getElementById("hint").textContent.indexOf("左边") !== -1, "guess phase");
  click(doc.getElementById("controls").children[1]);
  assert(doc.getElementById("hint").textContent.indexOf("揭示目标") !== -1, "reveal phase");

  const a0 = parseInt(doc.getElementById("scoreA").textContent, 10);
  click(doc.getElementById("controls").children[0]);
  assert(parseInt(doc.getElementById("scoreA").textContent, 10) >= a0, "A score updated after reveal");
  assert(doc.getElementById("screen").className.indexOf("open") !== -1, "screen open after reveal");
  assert(doc.getElementById("log").children.length === 1, "round logged");

  click(doc.getElementById("controls").children[0]);
  assert(doc.getElementById("screen").className.indexOf("open") === -1, "screen reset for new round");
  assert(doc.getElementById("hint").textContent.indexOf("粉队") !== -1, "turn switched to B");

  click("btn-restart");
  click("btn-reset-deck");
  assert(doc.getElementById("deck-info").textContent.indexOf("内置题库") !== -1, "reset restores builtin deck");
  assert(doc.getElementById("title-main").textContent === "GUESSY", "custom title persists after deck reset");

  console.log("ALL TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
