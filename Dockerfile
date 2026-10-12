# Сборка и запуск ЦИС ЖКХ г. Атырау в одном контейнере (Railway, Render, любой Docker-хостинг).
# База данных и файлы хранятся в /data — к этому пути нужно подключить постоянный диск (volume).

# 1. Сборка интерфейса
FROM node:24-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# 2. Сервер
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    COOKIE_SECURE=true \
    TRUST_PROXY=true
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
EXPOSE 3000
CMD ["node", "src/index.ts"]
