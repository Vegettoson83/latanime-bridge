FROM mcr.microsoft.com/playwright:v1.41.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

# Install MediaFlow Proxy
RUN apt-get update && apt-get install -y python3-pip python3-venv --no-install-recommends
RUN python3 -m venv /opt/mfp && /opt/mfp/bin/pip install --no-cache-dir mediaflow-proxy

ENV NODE_ENV=production
ENV API_PASSWORD=latanime
ENV FORWARDED_ALLOW_IPS=*
# Render exposes PORT (3000) publicly — MFP runs there
# Node bridge runs on 3001 internally
ENV PORT=3001
EXPOSE 3000

# MFP on 3000 (public), Node on 3001 (internal)
CMD /opt/mfp/bin/uvicorn mediaflow_proxy.main:app --host 0.0.0.0 --port 3000 --forwarded-allow-ips "*" & node server.js & wait
