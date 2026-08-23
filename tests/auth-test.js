process.env.PORT = "0";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { JSDOM } = require("jsdom");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wl-auth-"));
const configPath = path.join(tmp, "config.json");
const sessionsPath = path.join(tmp, "auth-sessions.json");
fs.writeFileSync(configPath, JSON.stringify({ password: "secret123" }));
process.env.WL_CONFIG = configPath;
process.env.WL_AUTH_SESSIONS = sessionsPath;

const serverPath = path.join(__dirname, "..", "server.js");
let { server } = require(serverPath);

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let BASE = "";

function req(method, url, body, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = body ? { "Content-Type": "application/json" } : {};
    if (cookie) headers.Cookie = cookie;
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method,
      headers
    }, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
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

function makePage() {
  const jar = { cookie: "" };
  class FakeES {
    constructor() {
      this.onmessage = null;
      this.onopen = null;
      this._buf = "";
      const opts = jar.cookie ? { headers: { Cookie: jar.cookie } } : {};
      const rq = http.get(BASE + "/api/stream", opts, (res) => {
        if (res.statusCode !== 200) return;
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
  const dom = new JSDOM(html, {
    url: BASE + "/index.html",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = async (u, opts) => {
        opts = opts || {};
        opts.headers = Object.assign({}, opts.headers || {});
        if (jar.cookie) opts.headers.Cookie = jar.cookie;
        const res = await global.fetch(new URL(u, BASE + "/").href, opts);
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) {
          const pair = setCookie.split(";", 1)[0];
          jar.cookie = pair.endsWith("=") ? "" : pair;
        }
        return res;
      };
      window.EventSource = FakeES;
    }
  });
  dom.authJar = jar;
  return dom;
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

  r = await req("POST", BASE + "/api/auth", { password: "secret123" });
  assert(r.status === 200 && Array.isArray(r.headers["set-cookie"]), "correct password sets device cookie");
  const apiCookie = r.headers["set-cookie"][0].split(";", 1)[0];
  assert(r.headers["set-cookie"][0].includes("HttpOnly") && r.headers["set-cookie"][0].includes("SameSite=Strict"), "auth cookie is protected");
  assert((await req("GET", BASE + "/api/decks", null, apiCookie)).status === 200, "authenticated device can use protected API");
  assert((await req("GET", BASE + "/api/decks")).status === 401, "second device on same IP remains unauthenticated");
  assert((await req("GET", BASE + "/api/stream")).status === 401, "SSE rejects missing cookie");

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

  r = await req("GET", BASE + "/api/ping", null, page.authJar.cookie);
  j = JSON.parse(r.body);
  assert(j.authed === true, "device cookie remembered as authed");
  const saved = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
  assert(saved.sessions.length === 2 && !JSON.stringify(saved).includes(apiCookie.split("=")[1]), "only token hashes persisted");

  await new Promise((resolve) => server.close(resolve));
  delete require.cache[require.resolve(serverPath)];
  ({ server } = require(serverPath));
  await new Promise((resolve) => server.once("listening", resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  assert((await req("GET", BASE + "/api/decks", null, apiCookie)).status === 200, "device session survives server restart");

  r = await req("POST", BASE + "/api/logout", null, apiCookie);
  assert(r.status === 200 && r.headers["set-cookie"][0].includes("Max-Age=0"), "logout clears cookie");
  assert((await req("GET", BASE + "/api/decks", null, apiCookie)).status === 401, "logout revokes current device session");

  await new Promise((resolve) => server.close(resolve));
  const expiredStore = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
  expiredStore.sessions.forEach((session) => { session.expiresAt = 0; });
  fs.writeFileSync(sessionsPath, JSON.stringify(expiredStore));
  delete require.cache[require.resolve(serverPath)];
  ({ server } = require(serverPath));
  await new Promise((resolve) => server.once("listening", resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  assert((await req("GET", BASE + "/api/decks", null, page.authJar.cookie)).status === 401, "expired session is rejected");

  r = await req("POST", BASE + "/api/auth", { password: "secret123" });
  const cookieBeforeDelete = r.headers["set-cookie"][0].split(";", 1)[0];
  await new Promise((resolve) => server.close(resolve));
  fs.unlinkSync(sessionsPath);
  delete require.cache[require.resolve(serverPath)];
  ({ server } = require(serverPath));
  await new Promise((resolve) => server.once("listening", resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  assert((await req("GET", BASE + "/api/decks", null, cookieBeforeDelete)).status === 401, "deleting session file revokes all devices");

  r = await req("POST", BASE + "/api/auth", { password: "secret123" });
  const cookieBeforePasswordChange = r.headers["set-cookie"][0].split(";", 1)[0];
  await new Promise((resolve) => server.close(resolve));
  fs.writeFileSync(configPath, JSON.stringify({ password: "changed-password" }));
  delete require.cache[require.resolve(serverPath)];
  ({ server } = require(serverPath));
  await new Promise((resolve) => server.once("listening", resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  assert((await req("GET", BASE + "/api/decks", null, cookieBeforePasswordChange)).status === 401, "password change invalidates old sessions");

  server.close();
  console.log("AUTH TEST PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
