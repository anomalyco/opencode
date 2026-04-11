# OpenCode Veritly on Railway

Build and run from [`Dockerfile`](Dockerfile) in this directory (`vendor/opencode-veritly`). Set **`OPENCODE_SERVER_PASSWORD`** and any required **`VITE_*`** build args in Railway.

**Production visibility:** use **`railway logs`**, a log drain, or structured logging you add in app code. Remote Bun inspectors, Tailscale debug hooks, and IDE attach configs were removed from this repo path in favor of logs.
