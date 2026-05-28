# Cloud Run 用 Bun ランタイムイメージ
FROM oven/bun:1-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# 依存のみ先に入れてレイヤキャッシュを効かせる
COPY package.json ./
RUN bun install --production

COPY src ./src

# Cloud Run は $PORT を注入する（既定 8080）。Bun は default export の
# { port, fetch } を見て自動でサーバを起動する。
CMD ["bun", "run", "src/index.ts"]
