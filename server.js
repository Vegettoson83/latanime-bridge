const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/ping", (req, res) => res.send("OK"));

app.get("/extract", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url param" });

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[cache] ${url}`);
    return res.json({ url: cached.url, cached: true });
  }

  console.log(`[extract] ${url}`);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
             "--disable-gpu", "--no-zygote", "--disable-web-security"],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    let streamUrl = null;

    // Use page.route to intercept ALL requests — most reliable method
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (!streamUrl) {
        if (u.includes(".m3u8") || u.match(/\.(mp4|mkv)(\?|$)/)) {
          console.log(`[route intercept] ${u.slice(0, 120)}`);
          streamUrl = u;
        }
      }
      route.continue();
    });

    // Also listen to responses for content-type based detection
    page.on("response", async (response) => {
      if (streamUrl) return;
      try {
        const ct = response.headers()["content-type"] || "";
        const u = response.url();
        if (ct.includes("mpegurl") || ct.includes("x-m3u8")) {
          console.log(`[response content-type m3u8] ${u.slice(0, 120)}`);
          streamUrl = u;
        }
      } catch {}
    });

    // Navigate to the embed URL
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch (e) {
      console.log(`[nav warning] ${e.message}`);
    }

    // Try clicking any play button
    try {
      await page.waitForTimeout(1500);
      for (const sel of ['[class*="play"]', 'button', '.vjs-play-control', '#play-btn', 'video']) {
        const el = await page.$(sel);
        if (el) { await el.click().catch(() => {}); break; }
      }
    } catch {}

    // Poll for stream URL for up to 18 seconds
    const deadline = Date.now() + 18000;
    while (!streamUrl && Date.now() < deadline) {
      await page.waitForTimeout(400);

      // Scan inline scripts for m3u8
      if (!streamUrl) {
        try {
          const found = await page.evaluate(() => {
            // Check video element
            const v = document.querySelector("video");
            if (v?.src?.includes(".m3u8") || v?.currentSrc?.includes(".m3u8")) {
              return v.src || v.currentSrc;
            }
            const src = document.querySelector("source[src*='.m3u8']");
            if (src) return (src as HTMLSourceElement).src;

            // Scan script tags
            for (const s of document.querySelectorAll("script:not([src])")) {
              const m = s.textContent?.match(/["'`](https?:\/\/[^"'`\s]{10,}\.m3u8[^"'`\s]*)/);
              if (m) return m[1];
            }
            return null;
          });
          if (found) { streamUrl = found; console.log(`[eval found] ${found.slice(0, 100)}`); }
        } catch {}
      }
    }

    await browser.close();

    if (!streamUrl) {
      return res.status(404).json({ error: "No stream URL found", embedUrl: url });
    }

    cache.set(url, { url: streamUrl, ts: Date.now() });
    return res.json({ url: streamUrl, cached: false });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(`[error]`, err.message);
    return res.status(500).json({ error: err.message, embedUrl: url });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
}, 5 * 60 * 1000);

app.listen(PORT, () => console.log(`Bridge running on port ${PORT}`));
