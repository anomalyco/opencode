FROM oven/bun:1.3.8

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile
RUN bun --cwd packages/app build

EXPOSE 4096
