FROM oven/bun:1.2-alpine

WORKDIR /app

# Create proper package.json
RUN printf '{\n  "name": "@veritly/relay",\n  "version": "1.0.0",\n  "private": true,\n  "type": "module"\n}\n' > package.json

COPY server.ts .

ENV PORT=8080
ENV UNIVER_SDK_PORT=8080

EXPOSE 8080

CMD ["bun", "run", "server.ts"]
