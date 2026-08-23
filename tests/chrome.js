"use strict";

var fs = require("fs");

var CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  process.env.PROGRAMFILES && process.env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe",
  process.env["PROGRAMFILES(X86)"] && process.env["PROGRAMFILES(X86)"] + "\\Google\\Chrome\\Application\\chrome.exe"
].filter(Boolean);

function findChrome() {
  for (var i = 0; i < CANDIDATES.length; i++) {
    if (fs.existsSync(CANDIDATES[i])) return CANDIDATES[i];
  }
  throw new Error("未找到 Chrome/Chromium。请安装浏览器或设置 CHROME_PATH=/path/to/chrome");
}

module.exports = findChrome;
