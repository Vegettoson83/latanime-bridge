FROM mcr.microsoft.com/playwright:v1.41.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
