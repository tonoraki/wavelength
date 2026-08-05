var http = require("http");
var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var WL = require("./game.js");

var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
var ROOT = __dirname;
var CONFIG_PATH = process.env.WL_CONFIG || path.join(ROOT, "config.json");
var AUTH_IPS_PATH = process.env.WL_AUTH_IPS || path.join(ROOT, "auth-ips.json");
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8"
};

var state = WL.createGame();
var clients = new Set();
var DECKS_DIR = path.join(ROOT, "decks");

function loadConfig() {
  try {
    var c = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { password: typeof c.password === "string" ? c.password : "" };
  } catch (e) {
    return { password: "" };
  }
}

var config = loadConfig();
var authedIps = new Set();
try {
  var savedIps = JSON.parse(fs.readFileSync(AUTH_IPS_PATH, "utf8"));
  if (Array.isArray(savedIps)) savedIps.forEach(function (ip) { authedIps.add(ip); });
} catch (e) {}

function saveAuthedIps() {
  try {
    fs.writeFileSync(AUTH_IPS_PATH, JSON.stringify(Array.from(authedIps)));
  } catch (e) {}
}

function clientIp(req) {
  return String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

function safeEqual(a, b) {
  var ba = Buffer.from(String(a));
  var bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isAuthed(req) {
  if (!config.password) return true;
  return authedIps.has(clientIp(req));
}

function requireAuth(req, res, cb) {
  if (isAuthed(req)) return cb();
  sendJson(res, 401, { ok: false, error: "需要密码" });
}

function listDecks() {
  var out = [];
  var files;
  try {
    files = fs.readdirSync(DECKS_DIR);
  } catch (e) {
    return out;
  }
  files.filter(function (f) {
    return /\.(json|ya?ml)$/i.test(f);
  }).forEach(function (f) {
    try {
      var parsed = WL.parseDeck(fs.readFileSync(path.join(DECKS_DIR, f), "utf8"));
      out.push({ file: f, name: parsed.name || f.replace(/\.(json|ya?ml)$/i, ""), cards: parsed.cards.length });
    } catch (e) {
      out.push({ file: f, name: f, cards: 0, error: String(e.message) });
    }
  });
  return out;
}

try {
  var deckFile = fs.readFileSync(path.join(ROOT, "cards.json"), "utf8");
  var parsed = WL.parseDeck(deckFile);
  WL.applyIntent(state, { type: "loadDeck", name: parsed.name || "cards.json", cards: parsed.cards });
} catch (e) {
  console.log("未找到 cards.json（" + e.message + "），使用内置题库");
}

function broadcast() {
  var payload = "data: " + JSON.stringify(state) + "\n\n";
  clients.forEach(function (res) {
    try {
      res.write(payload);
    } catch (e) {
      clients.delete(res);
    }
  });
}

var keepalive = setInterval(function () {
  clients.forEach(function (res) {
    try {
      res.write(": keepalive\n\n");
    } catch (e) {
      clients.delete(res);
    }
  });
}, 15000);
keepalive.unref();

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req, cb) {
  var chunks = [];
  req.on("data", function (c) { chunks.push(c); });
  req.on("end", function () { cb(Buffer.concat(chunks).toString("utf8")); });
}

var server = http.createServer(function (req, res) {
  var url = decodeURIComponent((req.url || "/").split("?")[0]);

  if (req.method === "GET" && url === "/api/ping") {
    return sendJson(res, 200, {
      ok: true,
      authRequired: !!config.password,
      authed: isAuthed(req),
      deck: state.deckName,
      cards: state.cards.length
    });
  }

  if (req.method === "POST" && url === "/api/auth") {
    return readBody(req, function (body) {
      var pass = "";
      try {
        pass = JSON.parse(body).password || "";
      } catch (e) {}
      if (!config.password || safeEqual(pass, config.password)) {
        authedIps.add(clientIp(req));
        saveAuthedIps();
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 403, { ok: false, error: "密码错误" });
      }
    });
  }

  if (req.method === "GET" && url === "/api/decks") {
    return requireAuth(req, res, function () {
      sendJson(res, 200, { ok: true, decks: listDecks() });
    });
  }

  if (req.method === "POST" && url === "/api/deck/load") {
    return requireAuth(req, res, function () {
      readBody(req, function (body) {
        try {
          var d = JSON.parse(body);
          var found = null;
          listDecks().forEach(function (x) {
            if (x.file === d.file && !x.error) found = x;
          });
          if (!found) throw new Error("未找到题库文件：" + (d.file || ""));
          var parsed = WL.parseDeck(fs.readFileSync(path.join(DECKS_DIR, found.file), "utf8"));
          WL.applyIntent(state, { type: "loadDeck", name: parsed.name || found.name, cards: parsed.cards });
          broadcast();
          sendJson(res, 200, { ok: true, name: state.deckName, cards: state.cards.length });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
    });
  }

  if (req.method === "GET" && url === "/api/stream") {
    return requireAuth(req, res, function () {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write("retry: 2000\n\n");
      res.write("data: " + JSON.stringify(state) + "\n\n");
      clients.add(res);
      req.on("close", function () { clients.delete(res); });
    });
  }

  if (req.method === "POST" && url === "/api/intent") {
    return requireAuth(req, res, function () {
      readBody(req, function (body) {
        try {
          var intent = JSON.parse(body);
          WL.applyIntent(state, intent);
          broadcast();
          sendJson(res, 200, { ok: true, phase: state.phase });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
    });
  }

  if (req.method === "POST" && url === "/api/deck") {
    return requireAuth(req, res, function () {
      readBody(req, function (body) {
        try {
          var d = JSON.parse(body);
          var parsed = WL.parseDeck(d.text);
          WL.applyIntent(state, {
            type: "loadDeck",
            name: parsed.name || d.name || WL.DECK_NAME_DEFAULT,
            cards: parsed.cards
          });
          broadcast();
          sendJson(res, 200, { ok: true, name: state.deckName, cards: state.cards.length });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
    });
  }

  var filePath = path.normalize(path.join(ROOT, url === "/" ? "index.html" : url));
  if (filePath.indexOf(ROOT) !== 0) {
    return sendJson(res, 403, { ok: false, error: "forbidden" });
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

function lanAddresses() {
  var out = [];
  var ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    ifaces[name].forEach(function (iface) {
      if (iface.family === "IPv4" && !iface.internal) out.push(iface.address);
    });
  });
  return out;
}

server.listen(PORT, function () {
  console.log("Wavelength 服务器已启动");
  console.log("本机访问：   http://localhost:" + PORT);
  lanAddresses().forEach(function (ip) {
    console.log("局域网访问： http://" + ip + ":" + PORT);
  });
  console.log("iPad 选「控制器」，电脑开监视器，即可开始游戏");
});

module.exports = { server: server, state: state };
