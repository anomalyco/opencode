FROM node:22-alpine

RUN apk add --no-cache bash curl

WORKDIR /app

COPY server.mjs /app/server.mjs

ENV PORT=7777

EXPOSE 7777

CMD ["node", "/app/server.mjs"]
