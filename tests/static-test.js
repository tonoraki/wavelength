const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".yaml": "text/plain; charset=utf-8" };
const CHROME = "/usr/bin/google-chrome";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

(async function () {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const file = path.join(ROOT, url === "/" ? "index.html" : url);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("#setup-modal:not(.hidden)", { timeout: 5000 });
  assert(await page.$eval("#conn-badge", (el) => el.textContent.indexOf("本地模式") !== -1), "static host: badge shows local mode");
  await page.waitForFunction(() => document.getElementById("deck-info").textContent.indexOf("车万版") !== -1, { timeout: 5000 });
  console.log("ok: static host: cards.yaml deck loaded");

  await page.$eval("#select-first", (el) => { el.value = "A"; });
  await page.click("#btn-start");
  await page.waitForFunction(() => document.getElementById("hint").textContent.indexOf("查看目标") !== -1, { timeout: 5000 });
  console.log("ok: static host: game playable");

  assert(errors.length === 0, "no page errors: " + errors.join(" | "));
  browser.close();
  server.close();
  console.log("STATIC HOST TEST PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
