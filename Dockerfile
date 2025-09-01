FROM oven/bun:latest AS base

# Core tools required by server features (downloads, unzip, etc.) and gopls support
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       ca-certificates curl unzip tar git golang nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 opencode && \
    useradd -r -u 1001 -g opencode -m opencode

# Set working directory for the app layer
WORKDIR /app

# Copy only the opencode package files for a minimal build
COPY packages/opencode/package.json ./
RUN sed -i 's/"@opencode-ai\/sdk": "workspace:\*"/"@opencode-ai\/sdk": "latest"/g' package.json && \
    sed -i 's/"@opencode-ai\/plugin": "workspace:\*"/"@opencode-ai\/plugin": "latest"/g' package.json

# Install dependencies (production preferred, fall back to full)
RUN bun install --production || bun install

# Copy source code
COPY packages/opencode/src ./src
COPY packages/opencode/tsconfig.json ./

# Expose port
EXPOSE 8080

# Switch to non-root user
USER opencode

# Start the server
CMD ["bun", "run", "/app/src/index.ts", "serve", "--hostname", "0.0.0.0", "--port", "8080"]
