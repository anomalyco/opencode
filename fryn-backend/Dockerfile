FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs admin-cli.mjs ./
ENV NODE_ENV=production
ENV FRYN_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.mjs"]
