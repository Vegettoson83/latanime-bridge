# Latanime Bridge

Playwright headless Chrome bridge for extracting m3u8/mp4 stream URLs from JS-rendered embed hosts.

## Endpoints

- `GET /health` — health check
- `GET /extract?url=EMBED_URL` — extract stream URL (requires `x-api-key` header if API_KEY set)

## Deploy to Render

1. Push this repo to GitHub
2. Go to render.com → New → Web Service → connect repo
3. Render detects `render.yaml` automatically
4. Copy the `API_KEY` from Environment tab after deploy
5. Add it to your Cloudflare Worker as `BRIDGE_API_KEY`
6. Add the bridge URL as `BRIDGE_URL`

## Local dev

```bash
npm install
npx playwright install chromium --with-deps
node server.js
```
