FROM mcr.microsoft.com/playwright:v1.41.0-jammy

WORKDIR /app

COPY package.json .
RUN npm install

# Install Playwright browsers
RUN npx playwright install chromium --with-deps

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
