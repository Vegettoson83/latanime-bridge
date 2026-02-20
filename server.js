const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";

// Cache to avoid re-extracting the same URL
const cache = new Map();
const CACHE_TTL = 4 * 60 * 1000; // 4 minutes

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/extract", async (req, res) => {
  const { url } = req.query;
  const key = req.headers["x-api-key"] || req.query.key || "";

  if (API_KEY && key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!url) return res.status(400).json({ error: "Missing url param" });

  // Check cache
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[cache hit] ${url}`);
    return res.json({ url: cached.url, cached: true });
  }

  console.log(`[extract] ${url}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    });

    const page = await context.newPage();

    let streamUrl = null;

    // Intercept network requests — grab the first m3u8 or mp4
    page.on("request", (request) => {
      const reqUrl = request.url();
      if (streamUrl) return;
      if (
        (reqUrl.includes(".m3u8") || reqUrl.includes(".mp4")) &&
        !reqUrl.includes("capblank") &&
        !reqUrl.includes("blank")
      ) {
        console.log(`[intercepted] ${reqUrl}`);
        streamUrl = reqUrl;
      }
    });

    // Also intercept responses for m3u8 URLs in XHR/fetch
    page.on("response", async (response) => {
      if (streamUrl) return;
      const respUrl = response.url();
      const ct = response.headers()["content-type"] || "";
      if (
        ct.includes("mpegurl") ||
        ct.includes("m3u8") ||
        respUrl.includes(".m3u8")
      ) {
        streamUrl = respUrl;
        console.log(`[response m3u8] ${respUrl}`);
      }
    });

    // Navigate with timeout
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Wait up to 12 seconds for the stream URL to appear
    const deadline = Date.now() + 12000;
    while (!streamUrl && Date.now() < deadline) {
      await page.waitForTimeout(300);

      // Also check page source for m3u8 URLs that might be in JS vars
      if (!streamUrl) {
        const content = await page.content();
        const m3u8Match = content.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
        if (m3u8Match) streamUrl = m3u8Match[1];
      }
    }

    await browser.close();

    if (!streamUrl) {
      return res.status(404).json({ error: "No stream URL found", embedUrl: url });
    }

    // Cache and return
    cache.set(url, { url: streamUrl, ts: Date.now() });
    return res.json({ url: streamUrl, cached: false });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(`[error] ${url}:`, err.message);
    return res.status(500).json({ error: err.message, embedUrl: url });
  }
});

// Cleanup old cache entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
}, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Latanime bridge running on port ${PORT}`);
  console.log(`API_KEY: ${API_KEY ? "set" : "not set (open)"}`);
});
