FROM oven/bun:1.3.11-alpine

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY drizzle.config.ts ./
RUN bun install --production

COPY src ./src

EXPOSE 8787

CMD ["bun", "run", "src/index.ts"]
