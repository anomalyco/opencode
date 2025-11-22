FROM oven/bun:1-alpine

WORKDIR /app

# Copy pre-built application
COPY packages/enterprise/.output ./.output

# Expose default port
EXPOSE 3000

# Start the application
ENTRYPOINT ["bun", "run", ".output/server/index.mjs"]
