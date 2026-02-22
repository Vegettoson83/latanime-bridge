const express = require("express");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/ping",   (req, res) => res.send("OK"));
app.get("/",       (req, res) => res.json({ status: "ok", service: "latanime-bridge" }));

app.get("/extract", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url param" });

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    const cachedUrl = cached.url;
    const isStream = cachedUrl.includes(".m3u8") ||
      (cachedUrl.includes(".mp4") && !cachedUrl.includes("/embed") && !cachedUrl.includes("embed-"));
    if (isStream) {
      console.log(`[cache] ${url}`);
      return res.json({ url: cachedUrl, cached: true });
    }
    cache.delete(url);
  }

  console.log(`[extract] ${url}`);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-gpu", "--no-zygote", "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--window-size=1920,1080",
      ],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        "Accept-Language": "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
    });

    const page = await context.newPage();
    let streamUrl = null;

    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (!streamUrl) {
        if (u.includes(".m3u8")) {
          console.log(`[m3u8] ${u.slice(0, 100)}`);
          streamUrl = u;
        } else if (u.includes(".mp4") && !u.includes("/embed") && !u.includes("embed-") && !u.includes("analytics")) {
          try {
            const urlObj = new URL(u);
            if (urlObj.pathname.endsWith(".mp4") || urlObj.pathname.includes(".mp4?")) {
              console.log(`[mp4] ${u.slice(0, 100)}`);
              streamUrl = u;
            }
          } catch {}
        }
      }
      route.continue();
    });

    page.on("response", async (response) => {
      if (streamUrl) return;
      try {
        const ct = response.headers()["content-type"] || "";
        if (ct.includes("mpegurl") || ct.includes("x-m3u8")) {
          streamUrl = response.url();
          console.log(`[ct-m3u8] ${streamUrl.slice(0, 100)}`);
        }
      } catch {}
    });

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch (e) { console.log(`[nav] ${e.message}`); }

    try {
      await page.waitForTimeout(2000);
      for (const sel of ['.jw-icon-display', '.play-button', '[class*="play"]', 'video']) {
        const el = await page.$(sel);
        if (el) { await el.click().catch(() => {}); console.log(`[click] ${sel}`); break; }
      }
    } catch {}

    const deadline = Date.now() + 20000;
    while (!streamUrl && Date.now() < deadline) {
      await page.waitForTimeout(500);
      try {
        const found = await page.evaluate(() => {
          const v = document.querySelector("video");
          if (v?.src?.includes(".m3u8")) return v.src;
          if (v?.currentSrc?.includes(".m3u8")) return v.currentSrc;
          for (const s of document.querySelectorAll("script:not([src])")) {
            const m = s.textContent?.match(/["'`](https?:\/\/[^"'`\s]{10,}\.m3u8[^"'`\s]*)/);
            if (m) return m[1];
          }
          return null;
        });
        if (found) { streamUrl = found; console.log(`[eval] ${found.slice(0, 100)}`); }
      } catch {}
    }

    await browser.close();

    if (!streamUrl) return res.status(404).json({ error: "No stream URL found", embedUrl: url });

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
  for (const [k, v] of cache.entries()) if (now - v.ts > CACHE_TTL) cache.delete(k);
}, 5 * 60 * 1000);

app.listen(PORT, () => console.log(`Bridge running on port ${PORT}`));
