# @ghostty-web/demo

Cross-platform demo server for [ghostty-web](https://github.com/coder/ghostty-web) terminal emulator.

## Quick Start

```bash
npx @ghostty-web/demo@next
```

This starts a local web server with a fully functional terminal connected to your shell.
Works on **Linux** and **macOS** (no Windows support yet).

## What it does

- Starts an HTTP server on port 8080 (configurable via `PORT` env var)
- Serves WebSocket PTY on the same port at `/ws` endpoint
- Opens a real shell session (bash, zsh, etc.)
- Provides full PTY support (colors, cursor positioning, resize, etc.)
- Supports reverse proxies (ngrok, nginx, etc.) via X-Forwarded-\* headers

## Usage

```bash
# Default (port 8080)
npx @ghostty-web/demo@next

# Custom port
PORT=3000 npx @ghostty-web/demo@next
```

Then open http://localhost:8080 in your browser.

## Reverse Proxy Support

The server now supports reverse proxies like ngrok, nginx, and others by:

- Serving WebSocket on the same HTTP port (no separate port needed)
- Using relative WebSocket URLs on the client side
- Automatic protocol detection (HTTP/HTTPS, WS/WSS)

This means the WebSocket connection automatically adapts to use the same protocol and host as the HTTP connection, making it work seamlessly through any reverse proxy.

### Example with ngrok

```bash
# Start the demo server
npx @ghostty-web/demo@next

# In another terminal, expose it via ngrok
ngrok http 8080
```

The terminal will work seamlessly through the ngrok URL! Both HTTP and WebSocket traffic will be properly proxied.

### Example with nginx

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Security Warning

⚠️ **This server provides full shell access.**

Only use for local development and demos. Do not expose to untrusted networks.
