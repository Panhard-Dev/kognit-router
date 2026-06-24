FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates dumb-init fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app /app

RUN chmod +x /app/program/glm5.2proxy/glm5.2proxy-server /app/server/chromium-container \
  && mkdir -p /var/data/kognit \
  && chown -R node:node /var/data/kognit

ENV NODE_ENV=production \
  KOGNIT_SERVE_DIST=1 \
  KOGNIT_DATA_FILE=/var/data/kognit/data.json \
  ZCODE_PROXY_DATA_DIR=/var/data/kognit/glm5.2proxy \
  ZCODE_PROXY_HOST=127.0.0.1 \
  ZCODE_PROXY_PORT=3075 \
  ZCODE_CAPTCHA_BRIDGE=true \
  ZCODE_CAPTCHA_HEADLESS=false \
  ZCODE_CAPTCHA_CLIENT_PREFERENCE=standalone-browser \
  ZCODE_CAPTCHA_HEADLESS_EXECUTABLE=/app/server/chromium-container \
  ZCODE_CAPTCHA_HEADLESS_PROFILE_DIR=/var/data/kognit/glm5.2proxy/captcha-headless-profile \
  ZCODE_ACCOUNT_CREATOR_ENABLED=false \
  PORT=10000

USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:10000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/start-production.js"]
