const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";

const cache = new Map();
const CACHE_TTL = 4 * 60 * 1000;

app.get("/health", (req, res) => res.json({ status: "ok", version: "1.1" }));

app.get("/extract", async (req, res) => {
  const { url } = req.query;
  const key = req.headers["x-api-key"] || req.query.key || "";

  if (API_KEY && key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  if (!url) return res.status(400).json({ error: "Missing url param" });

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
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      extraHTTPHeaders: { "Accept-Language": "es-ES,es;q=0.9" },
    });

    const page = await context.newPage();
    let streamUrl = null;

    // Intercept ALL network requests
    page.on("request", (request) => {
      if (streamUrl) return;
      const u = request.url();
      if (u.includes(".m3u8") || (u.includes(".mp4") && u.includes("http") && !u.includes("analytics"))) {
        console.log(`[req intercepted] ${u.slice(0, 100)}`);
        streamUrl = u;
      }
    });

    page.on("response", async (response) => {
      if (streamUrl) return;
      const u = response.url();
      const ct = response.headers()["content-type"] || "";
      if (ct.includes("mpegurl") || ct.includes("x-m3u8") || u.includes(".m3u8")) {
        console.log(`[resp m3u8] ${u.slice(0, 100)}`);
        streamUrl = u;
      }
    });

    // Navigate
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });

    // Try clicking play button if present
    try {
      await page.waitForTimeout(2000);
      const playBtn = await page.$('button[class*="play"], .play-button, [id*="play"], video');
      if (playBtn) {
        await playBtn.click();
        console.log("[clicked play button]");
      }
    } catch {}

    // Wait up to 20 seconds for stream URL
    const deadline = Date.now() + 20000;
    while (!streamUrl && Date.now() < deadline) {
      await page.waitForTimeout(500);

      // Check page JS context for known patterns
      if (!streamUrl) {
        try {
          const found = await page.evaluate(() => {
            // VOE stores in window.voe or similar
            const src = (window as any)?.voe?.hls
              || (window as any)?.hls_url
              || (window as any)?.stream_url;
            if (src) return src;

            // Check all script content for m3u8
            const scripts = document.querySelectorAll("script:not([src])");
            for (const s of scripts) {
              const m = s.textContent?.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
              if (m) return m[1];
            }

            // Check video element src
            const video = document.querySelector("video source, video");
            if (video) {
              return (video as HTMLSourceElement).src || (video as HTMLVideoElement).currentSrc || null;
            }
            return null;
          });
          if (found && found.startsWith("http")) {
            console.log(`[js eval found] ${found.slice(0, 100)}`);
            streamUrl = found;
          }
        } catch {}
      }
    }

    await browser.close();

    if (!streamUrl) {
      return res.status(404).json({ error: "No stream URL found", embedUrl: url });
    }

    cache.set(url, { url: streamUrl, ts: Date.now() });
    return res.json({ url: streamUrl, cached: false });

  } catch (err: any) {
    if (browser) await browser.close().catch(() => {});
    console.error(`[error] ${url}:`, err.message);
    return res.status(500).json({ error: err.message, embedUrl: url });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
}, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Latanime bridge v1.1 running on port ${PORT}`);
});
