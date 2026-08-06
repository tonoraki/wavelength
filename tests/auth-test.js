process.env.PORT = "0";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { JSDOM } = require(path.join(__dirname, "node_modules", "jsdom"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wl-auth-"));
const configPath = path.join(tmp, "config.json");
const ipsPath = path.join(tmp, "auth-ips.json");
fs.writeFileSync(configPath, JSON.stringify({ password: "secret123" }));
process.env.WL_CONFIG = configPath;
process.env.WL_AUTH_IPS = ipsPath;

const { server } = require(path.join(__dirname, "..", "server.js"));

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let BASE = "";

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method,
      headers: body ? { "Content-Type": "application/json" } : {}
    }, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

class FakeES {
  constructor() {
    this.onmessage = null;
    this.onopen = null;
    this._buf = "";
    const rq = http.get(BASE + "/api/stream", (res) => {
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
    rq.on("error", () => {});
    this.close = () => { try { rq.destroy(); } catch (e) {} };
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

function click(doc, id) {
  const el = typeof id === "string" ? doc.getElementById(id) : id;
  if (!el) throw new Error("missing #" + id);
  el.dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
}

(async function () {
  await new Promise((r) => server.once("listening", r));
  BASE = `http://127.0.0.1:${server.address().port}`;

  let r = await req("GET", BASE + "/api/ping");
  let j = JSON.parse(r.body);
  assert(r.status === 200 && j.ok && j.authRequired === true && j.authed === false, "ping reports auth required");

  r = await req("GET", BASE + "/api/decks");
  assert(r.status === 401, "unauthenticated /api/decks rejected 401");
  r = await req("POST", BASE + "/api/intent", { type: "newGame" });
  assert(r.status === 401, "unauthenticated /api/intent rejected 401");
  r = await req("POST", BASE + "/api/auth", { password: "wrong" });
  assert(r.status === 403, "wrong password rejected");

  const guestPage = makePage();
  const gdoc = guestPage.window.document;
  await waitFor(() => gdoc.getElementById("auth-modal").className.indexOf("hidden") === -1, "guest sees password modal");
  click(gdoc, "btn-guest");
  await waitFor(() => gdoc.getElementById("setup-modal").className.indexOf("hidden") === -1, "guest enters setup modal (local hot-seat)");
  assert(gdoc.getElementById("conn-badge").textContent.indexOf("本地模式") !== -1, "guest badge shows local mode");
  gdoc.getElementById("select-first").value = "A";
  click(gdoc, "btn-start");
  await waitFor(() => gdoc.getElementById("hint").textContent.indexOf("查看目标") !== -1, "guest can play a full local round");
  console.log("ok: guest plays local hot-seat without password");

  const page = makePage();
  const doc = page.window.document;
  await waitFor(() => doc.getElementById("auth-modal").className.indexOf("hidden") === -1, "password modal shown");
  assert(doc.getElementById("role-modal").className.indexOf("hidden") !== -1, "role modal NOT shown before auth");

  doc.getElementById("auth-password").value = "wrong";
  click(doc, "btn-auth");
  await waitFor(() => doc.getElementById("auth-msg").textContent.indexOf("密码错误") !== -1, "wrong password error shown");

  doc.getElementById("auth-password").value = "secret123";
  click(doc, "btn-auth");
  await waitFor(() => doc.getElementById("role-modal").className.indexOf("hidden") === -1, "role modal after correct auth");
  await waitFor(() => doc.getElementById("conn-badge").textContent.indexOf("已连接") !== -1, "badge connected after auth");

  r = await req("GET", BASE + "/api/ping");
  j = JSON.parse(r.body);
  assert(j.authed === true, "IP remembered as authed");
  assert(JSON.parse(fs.readFileSync(ipsPath, "utf8")).length === 1, "auth-ips persisted to file");

  server.close();
  console.log("AUTH TEST PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
