process.env.PORT = "0";
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer-core");
const findChrome = require("./chrome.js");
const { server } = require(path.join(__dirname, "..", "server.js"));

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

function postIntent(port, intent) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(intent);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/intent",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw) }
    }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.end(raw);
  });
}

(async function () {
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 3904, height: 672, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("#role-modal:not(.hidden)", { timeout: 5000 });
  await page.click("#btn-role-monitor");
  await postIntent(port, { type: "setup", teamA: "蓝队", teamB: "粉队", first: "A" });
  await page.waitForFunction(() => document.body.classList.contains("monitor-mode") && document.getElementById("sides").children.length > 0);
  await postIntent(port, { type: "selectSide", side: 0 });
  await postIntent(port, { type: "donePsychic" });
  await postIntent(port, { type: "setDial", value: 600 });
  await postIntent(port, { type: "lock" });
  await page.waitForFunction(() => document.getElementById("hint").textContent.includes("中心楔形"));
  const guessPromptFit = await page.$eval("#hint", (el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    bottom: el.getBoundingClientRect().bottom
  }));
  assert(guessPromptFit.scrollHeight <= guessPromptFit.clientHeight && guessPromptFit.bottom <= 672, "long left/right prompt stays inside its grid area");
  await postIntent(port, { type: "guess", guess: "R" });
  await page.waitForSelector(".guess-choice");

  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      scoreboard: rect(".scoreboard"),
      card: rect(".card-area"),
      axis: rect(".axis"),
      log: rect(".log"),
      guess: rect(".guess-choice"),
      guessText: document.querySelector(".guess-choice").textContent,
      controls: getComputedStyle(document.getElementById("controls")).display,
      rules: getComputedStyle(document.querySelector("details.rules")).display,
      bodyClass: document.body.className
    };
  });

  assert(layout.viewport.width === 3904 && layout.viewport.height === 672, "uses exact 3904x672 viewport");
  assert(layout.bodyClass.includes("monitor-mode"), "monitor role enables wide-screen layout");
  assert(layout.scroll.width <= 3904 && layout.scroll.height <= 672, "layout has no page overflow");
  assert(layout.scoreboard.width >= 600 && layout.card.width >= 1800 && layout.log.width >= 600, "three columns use the ultra-wide canvas");
  assert(layout.scoreboard.right < layout.card.left && layout.card.right < layout.log.left, "three columns do not overlap");
  assert(layout.axis.width >= 1800 && layout.axis.height >= 72, "spectrum is wide and readable");
  assert(layout.guess.width >= 500 && layout.guessText.includes("右边"), "ultra-wide monitor prominently shows the opponent choice");
  assert(layout.scoreboard.bottom <= 672 && layout.log.bottom <= 672, "side panels fit the low-height display");
  assert(layout.controls === "none" && layout.rules === "block", "monitor layout hides controls and keeps rules button");

  await page.click("details.rules > summary");
  const rulesOverlay = await page.evaluate(() => {
    const details = document.querySelector("details.rules");
    const r = details.getBoundingClientRect();
    const listStyle = getComputedStyle(details.querySelector("ul"));
    return {
      open: details.open,
      width: r.width,
      height: r.height,
      fontSize: parseFloat(listStyle.fontSize),
      columns: listStyle.columnCount
    };
  });
  assert(rulesOverlay.open, "rules button opens the overlay");
  assert(rulesOverlay.width >= 3800 && rulesOverlay.height >= 620, "rules overlay fills almost the entire display");
  assert(rulesOverlay.fontSize >= 22 && rulesOverlay.columns === "2", "rules use large two-column text");

  await page.click("details.rules > summary");
  await postIntent(port, { type: "newGame" });
  await postIntent(port, { type: "setup", teamA: "超长名称蓝队", teamB: "超长名称粉队", first: "A" });
  await postIntent(port, { type: "selectSide", side: 0 });
  await postIntent(port, { type: "donePsychic" });
  await postIntent(port, { type: "setDial", value: 600 });
  await postIntent(port, { type: "lock" });
  await page.setViewport({ width: 1952, height: 336, deviceScaleFactor: 1 });
  await page.waitForFunction(() => innerWidth === 1952 && document.getElementById("hint").textContent.includes("中心楔形"));
  const scaledLayout = await page.evaluate(() => {
    const hint = document.getElementById("hint");
    const r = hint.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      hintClientHeight: hint.clientHeight,
      hintScrollHeight: hint.scrollHeight,
      hintBottom: r.bottom
    };
  });
  assert(scaledLayout.scrollWidth <= 1952 && scaledLayout.scrollHeight <= 336, "layout also fits a 200%-scaled 3904x672 display");
  assert(scaledLayout.hintScrollHeight <= scaledLayout.hintClientHeight && scaledLayout.hintBottom <= 336, "long prompt remains contained under display scaling");

  if (process.argv.includes("--screenshot")) {
    await page.screenshot({ path: path.join(__dirname, "ultrawide-qa.png") });
  }
  await browser.close();
  server.close();
  console.log("ULTRAWIDE MONITOR TEST PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
