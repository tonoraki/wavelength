process.env.PORT = "0";
const http = require("http");
const path = require("path");
const { server, state, MAX_BODY_BYTES } = require(path.join(__dirname, "..", "server.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function reqRaw(method, url, raw, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method, headers: headers || {}
    }, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    r.on("error", reject);
    r.end(raw);
  });
}

function jsonBodyOfSize(size) {
  const empty = JSON.stringify({ type: "noop", padding: "" });
  return JSON.stringify({ type: "noop", padding: "x".repeat(size - Buffer.byteLength(empty)) });
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok: " + msg);
}

let streamText = "";
function latestSnapshot() {
  const frames = streamText.split("\n\n").filter((f) => f.startsWith("data: "));
  return JSON.parse(frames[frames.length - 1].slice(6));
}

(async function () {
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let r = await req("GET", base + "/api/ping");
  let j = JSON.parse(r.body);
  assert(r.status === 200 && j.ok === true && j.authRequired === false, "ping ok, no auth");

  r = await req("GET", base + "/");
  assert(r.status === 200 && r.body.indexOf("WAVELENGTH") !== -1, "index.html served");
  r = await req("GET", base + "/game.js");
  assert(r.status === 200, "game.js served");
  r = await req("GET", base + "/app.js");
  assert(r.status === 200, "app.js served");
  r = await req("GET", base + "/app.css");
  assert(r.status === 200, "app.css served");
  r = await req("GET", base + "/nope");
  assert(r.status === 404, "missing file 404");

  const streamReq = http.get(base + "/api/stream", (res) => {
    res.on("data", (c) => { streamText += c.toString(); });
  });
  await sleep(150);
  assert(latestSnapshot().phase === "setup", "initial SSE snapshot phase setup");

  r = await req("POST", base + "/api/intent", { type: "setup", teamA: "蓝", teamB: "粉", first: "A" });
  assert(r.status === 200, "setup intent accepted");
  await sleep(100);
  let s = latestSnapshot();
  assert(s.phase === "psychic" && s.round === 1, "round 1 psychic after setup");
  assert(s.teams.A.score === 0 && s.teams.B.score === 1, "scores 0/1 synced");

  await req("POST", base + "/api/intent", { type: "lock" });
  await sleep(100);
  assert(latestSnapshot().phase === "psychic", "invalid intent (lock in psychic) ignored");

  await req("POST", base + "/api/intent", { type: "selectSide", side: 0 });
  await req("POST", base + "/api/intent", { type: "startDialTimer", timerSeconds: 60 });
  await req("POST", base + "/api/intent", { type: "donePsychic" });
  await sleep(50);
  s = latestSnapshot();
  assert(s.timerKind === "dial" && s.timerEnd > Date.now(), "dial timer synced and continues after psychic closes target");
  await req("POST", base + "/api/intent", { type: "setDial", value: 750 });
  await req("POST", base + "/api/intent", { type: "lock", timerSeconds: 15 });
  await sleep(50);
  s = latestSnapshot();
  assert(s.phase === "guess" && s.timerKind === "guess" && s.timerEnd > Date.now(), "guess timer starts after dial locks");
  await req("POST", base + "/api/intent", { type: "guess", guess: "R" });
  await sleep(100);
  s = latestSnapshot();
  assert(s.phase === "reveal" && s.dial === 750 && s.guess === "R", "round state synced to reveal");
  assert(s.timerKind === null && s.timerEnd === null, "timer clears after left/right choice");

  await req("POST", base + "/api/intent", { type: "reveal" });
  await sleep(100);
  s = latestSnapshot();
  assert(s.phase === "revealed", "phase revealed after reveal intent");
  assert(s.reveal && s.reveal.guess === "R", "reveal data broadcast");
  assert(s.log.length === 1 && s.log[0].round === 1, "log entry broadcast");

  await req("POST", base + "/api/intent", { type: "nextRound" });
  await sleep(100);
  s = latestSnapshot();
  assert(s.phase === "psychic" && s.active === "B" && s.round === 2, "next round switched to B");
  assert(s.reveal === null, "next round clears previous reveal result");

  const beforeSkip = latestSnapshot().card;
  await req("POST", base + "/api/intent", { type: "skipCard" });
  await sleep(100);
  s = latestSnapshot();
  assert(s.phase === "psychic" && s.round === 2, "skip stays in psychic, round unchanged");
  assert(JSON.stringify(s.card) !== JSON.stringify(beforeSkip), "skip draws a different card");

  await req("POST", base + "/api/intent", { type: "setOrdered", value: true });
  await req("POST", base + "/api/intent", { type: "setWinScore", value: 0 });
  await sleep(100);
  s = latestSnapshot();
  assert(s.ordered === true, "ordered flag synced");
  assert(s.winScore === 0, "win score 0 (unlimited) synced");

  await req("POST", base + "/api/intent", { type: "setWinScore", value: -5 });
  await sleep(100);
  assert(latestSnapshot().winScore === 0, "negative win score coerced to 0");

  r = await req("POST", base + "/api/deck", { name: "mydeck", text: "- [甲, 乙]\n- [丙, 丁, 戊, 己]\n" });
  j = JSON.parse(r.body);
  assert(r.status === 200 && j.cards === 2, "deck uploaded via API");
  r = await req("POST", base + "/api/deck", { name: "bad", text: "not yaml at all" });
  assert(r.status === 400, "bad deck rejected");

  r = await req("GET", base + "/api/decks");
  j = JSON.parse(r.body);
  assert(r.status === 200 && Array.isArray(j.decks) && j.decks.length >= 2, "decks folder listed");
  const folderDeck = j.decks[0];
  r = await req("POST", base + "/api/deck/load", { file: folderDeck.file });
  j = JSON.parse(r.body);
  assert(r.status === 200 && j.cards === folderDeck.cards, "folder deck loaded by name");
  r = await req("POST", base + "/api/deck/load", { file: "../cards.yaml" });
  assert(r.status === 400, "path traversal rejected");

  r = await reqRaw("POST", base + "/api/intent", "{bad json", {
    "Content-Type": "application/json"
  });
  assert(r.status === 400, "invalid JSON rejected 400");
  const exactBody = jsonBodyOfSize(MAX_BODY_BYTES);
  assert(Buffer.byteLength(exactBody) === MAX_BODY_BYTES, "exact-limit fixture is 256 KiB");
  r = await reqRaw("POST", base + "/api/intent", exactBody, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(exactBody)
  });
  assert(r.status === 200, "request exactly at body limit accepted");
  const overBody = jsonBodyOfSize(MAX_BODY_BYTES + 1);
  r = await reqRaw("POST", base + "/api/intent", overBody, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(overBody)
  });
  assert(r.status === 413, "oversized declared body rejected 413");
  r = await reqRaw("POST", base + "/api/intent", overBody, {
    "Content-Type": "application/json",
    "Transfer-Encoding": "chunked"
  });
  assert(r.status === 413, "oversized streamed body rejected 413");

  streamReq.destroy();
  server.close();
  console.log("SERVER TEST PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
