FROM mcr.microsoft.com/playwright:v1.41.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

# Install MediaFlow Proxy alongside the Node bridge
RUN apt-get update && apt-get install -y python3-pip python3-venv --no-install-recommends
RUN python3 -m venv /opt/mfp && /opt/mfp/bin/pip install --no-cache-dir mediaflow-proxy

ENV NODE_ENV=production
ENV API_PASSWORD=latanime
ENV FORWARDED_ALLOW_IPS=*
EXPOSE 3000 8888

# Start both services
CMD node server.js & /opt/mfp/bin/uvicorn mediaflow_proxy.main:app --host 0.0.0.0 --port 8888 --forwarded-allow-ips "*" & wait
