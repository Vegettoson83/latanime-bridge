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
ENV MFP_PORT=3001
ENV PORT=3000
EXPOSE 3000

# MediaFlow on 3001 (internal), Node bridge on 3000 (Render public port)
CMD /opt/mfp/bin/uvicorn mediaflow_proxy.main:app --host 0.0.0.0 --port 3001 --forwarded-allow-ips "*" & node server.js & wait
