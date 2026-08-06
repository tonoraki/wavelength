process.env.PORT = "0";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require(path.join(__dirname, "node_modules", "jsdom"));
const { server } = require(path.join(__dirname, "..", "server.js"));

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let BASE = "";

class FakeES {
  constructor(url) {
    this.onmessage = null;
    this.onopen = null;
    this._buf = "";
    const req = http.get(BASE + "/api/stream", (res) => {
      setTimeout(() => { if (this.onopen) this.onopen(); }, 10);
      res.on("data", (c) => {
        this._buf += c.toString();
        let idx;
        while ((idx = this._buf.indexOf("\n\n")) !== -1) {
          const frame = this._buf.slice(0, idx);
          this._buf = this._buf.slice(idx + 2);
          const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (data && this.onmessage) this.onmessage({ data });
        }
      });
    });
    req.on("error", () => {});
    this.close = () => { try { req.destroy(); } catch (e) {} };
  }
}

function makePage() {
  return new JSDOM(html, {
    url: BASE + "/index.html",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, opts) => global.fetch(new URL(u, BASE + "/").href, opts);
      window.EventSource = FakeES;
    }
  });
}

async function waitFor(fn, msg, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (fn()) return; } catch (e) {}
    await sleep(50);
  }
  throw new Error("TIMEOUT waiting for: " + msg);
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

function click(doc, id) {
  const el = typeof id === "string" ? doc.getElementById(id) : id;
  if (!el) throw new Error("missing #" + id);
  el.dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
}

(async function () {
  await new Promise((r) => server.once("listening", r));
  BASE = `http://127.0.0.1:${server.address().port}`;

  const controller = makePage();
  const monitor = makePage();
  const cdoc = controller.window.document;
  const mdoc = monitor.window.document;

  await waitFor(() => cdoc.getElementById("role-modal").className.indexOf("hidden") === -1, "controller sees role modal");
  await waitFor(() => mdoc.getElementById("conn-badge").textContent.indexOf("已连接") !== -1, "monitor badge connected");

  click(cdoc, "btn-role-controller");
  click(mdoc, "btn-role-monitor");

  await waitFor(() => cdoc.getElementById("setup-modal").className.indexOf("hidden") === -1, "controller setup modal");
  await waitFor(() => mdoc.getElementById("btn-restart").style.display === "none", "monitor restart hidden");

  await waitFor(() => cdoc.getElementById("deck-select").children.length > 1, "deck select populated from folder");
  const chosenDeck = await (async () => {
    const opt = cdoc.getElementById("deck-select").children[1];
    return { name: opt.textContent.split(" · ")[0], file: opt.value };
  })();
  const sel = cdoc.getElementById("deck-select");
  sel.value = chosenDeck.file;
  sel.dispatchEvent(new cdoc.defaultView.Event("change", { bubbles: true }));
  await waitFor(() => mdoc.getElementById("deck-badge").textContent === chosenDeck.name, "monitor deck badge synced");

  cdoc.getElementById("input-nameA").value = "蓝队";
  cdoc.getElementById("input-nameB").value = "粉队";
  cdoc.getElementById("select-first").value = "A";
  click(cdoc, "btn-start");

  await waitFor(() => mdoc.getElementById("hint").textContent.indexOf("查看目标") !== -1, "monitor sees psychic phase");
  assert(cdoc.getElementById("scoreB").textContent === "1", "controller sees B score 1");

  const mSides = mdoc.getElementById("sides").children;
  for (let i = 0; i < mSides.length; i++) {
    assert(!mSides[i].disabled, "monitor side not greyed");
    assert(mSides[i].className.indexOf("readonly") !== -1, "monitor side readonly");
  }

  click(cdoc, cdoc.getElementById("controls").children[0]);
  assert(cdoc.getElementById("screen").className.indexOf("open") !== -1, "controller screen open for psychic");
  await sleep(150);
  assert(mdoc.getElementById("screen").className.indexOf("open") === -1, "monitor screen stays closed (secret)");

  click(cdoc, cdoc.getElementById("controls").children[0]);
  await waitFor(() => mdoc.getElementById("hint").textContent.indexOf("拖动金色拨杆") !== -1, "monitor sees dial phase");

  const axis = cdoc.getElementById("axis");
  axis.getBoundingClientRect = () => ({ left: 0, width: 1000 });
  const interact = cdoc.getElementById("interact");
  const PE = controller.window.PointerEvent || controller.window.MouseEvent;
  interact.dispatchEvent(new PE("pointerdown", { clientX: 250, pointerId: 1, bubbles: true }));
  interact.dispatchEvent(new PE("pointermove", { clientX: 600, pointerId: 1, bubbles: true }));
  interact.dispatchEvent(new controller.window.Event("pointerup", { bubbles: true }));
  await waitFor(() => mdoc.getElementById("dial").style.left === "60%", "monitor dial synced to 60%");

  click(cdoc, "btn-lock");
  await waitFor(() => mdoc.getElementById("hint").textContent.indexOf("左边") !== -1, "monitor sees guess phase");
  click(cdoc, cdoc.getElementById("controls").children[1]);
  await waitFor(() => mdoc.getElementById("hint").textContent.indexOf("揭示目标") !== -1, "monitor sees reveal phase");

  click(cdoc, cdoc.getElementById("controls").children[0]);
  await waitFor(() => mdoc.getElementById("screen").className.indexOf("open") !== -1, "monitor screen open after reveal");
  await waitFor(() => mdoc.getElementById("log").children.length === 1, "monitor log has 1 entry");

  click(cdoc, cdoc.getElementById("controls").children[0]);
  await waitFor(() => mdoc.getElementById("hint").textContent.indexOf("粉队") !== -1, "monitor turn switched to B");

  click(cdoc, cdoc.getElementById("btn-restart"));
  await waitFor(() => mdoc.getElementById("hint").textContent.indexOf("等待控制器开始游戏") !== -1, "monitor sees waiting hint after restart");

  server.close();
  console.log("ONLINE TEST PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
