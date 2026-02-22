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
ENV PORT=3000
EXPOSE 3000

# Node on 3000 (public), MFP on 8888 (internal only)
CMD /opt/mfp/bin/uvicorn mediaflow_proxy.main:app --host 127.0.0.1 --port 8888 --forwarded-allow-ips "*" & node server.js & wait
