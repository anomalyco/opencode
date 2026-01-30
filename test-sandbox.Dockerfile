# Basic sandbox container for testing purposes
FROM alpine:latest AS base

# Install dependencies
RUN apk add --no-cache \
    git \
    ripgrep \
    curl \
    ca-certificates \
    libgcc \
    libstdc++ \
    openssh-client \
    nodejs \
    npm \
    dumb-init

WORKDIR /app

# Copy the built binary from the dist folder
COPY ./packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode

# Create a non-root user for security
RUN addgroup -g 1001 sandbox && \
    adduser -D -u 1001 -G sandbox -s /bin/sh sandbox

# Create workspace directory
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace

# Create data directory for opencode
RUN mkdir -p /home/sandbox/.opencode && chown sandbox:sandbox /home/sandbox/.opencode

# Set up dumb-init as entrypoint to properly handle signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Volume for project files
VOLUME /workspace

# Environment variables
ENV OPENCODE_SERVER_HOSTNAME=0.0.0.0
ENV OPENCODE_SERVER_PORT=4096
ENV OPENCODE_DATA_DIR=/home/sandbox/.opencode
ENV HOME=/home/sandbox
ENV PATH="/usr/local/bin:$PATH"

# Switch to non-root user
USER sandbox
WORKDIR /workspace

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD nc -z localhost 4096 || exit 1

# Expose opencode server port
EXPOSE 4096

# Default command to start opencode server
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]