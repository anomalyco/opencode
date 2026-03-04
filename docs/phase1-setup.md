# OPENSACIA Phase 1: Setup and Running

## Building for Production

```bash
# Build the web UI
bun run --cwd packages/app build

# Run the server
bun run packages/opencode/src/index.ts serve
```

The server will start on `http://localhost:4096` by default.

## Air-Gapped Operation

Once built, OPENSACIA operates completely offline:

1. Build the application (requires internet for dependencies)
2. Transfer the entire `OPENSACIA/` directory to air-gapped system
3. Run: `bun run packages/opencode/src/index.ts serve`

All assets are served locally with no external dependencies.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSACIA_SERVER_PASSWORD` | (none) | Enable basic authentication |
| `OPENSACIA_SERVER_USERNAME` | `opensacia` | Username for basic auth |

**Note:** For backward compatibility, `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` are also supported.

### Command Line Options

```bash
# Bind to all interfaces (network access)
bun run packages/opencode/src/index.ts serve --hostname 0.0.0.0

# Enable mDNS discovery
bun run packages/opencode/src/index.ts serve --mdns --mdns-domain opensacia.local

# Custom port
bun run packages/opencode/src/index.ts serve --port 8080
```

## Accessing the Web UI

- **Local:** http://localhost:4096
- **Network:** http://<server-ip>:4096
- **mDNS:** http://opensacia.local:4096 (when mDNS is enabled)

## Authentication

When `OPENSACIA_SERVER_PASSWORD` is set, the web UI requires basic authentication:

```bash
# Start with authentication
OPENSACIA_SERVER_PASSWORD=secure123 bun run packages/opencode/src/index.ts serve

# Access with credentials (using curl)
curl -u opensacia:secure123 http://localhost:4096/
```

Default credentials:
- **Username:** `opensacia` (configurable via `OPENSACIA_SERVER_USERNAME`)
- **Password:** (value of `OPENSACIA_SERVER_PASSWORD`)

## Troubleshooting

### "Static build not found" error

If you see this error, run the build command first:

```bash
bun run --cwd packages/app build
```

### Server returns 404

Ensure:
1. The build was completed successfully
2. You're running from the project root directory
3. The `packages/app/dist/` directory exists

### Port already in use

Use a different port:

```bash
bun run packages/opencode/src/index.ts serve --port 8080
```

## Architecture Notes

### Phase 1 Changes

- **Static Asset Serving:** Replaced cloud proxy (`app.opencode.ai`) with local static file serving
- **Build Configuration:** Configured Vite for production-ready static builds
- **No External Dependencies:** All assets bundled locally for air-gapped operation
- **Rebranding:** Changed from "OpenCode" to "OPENSACIA" in UI and configuration

### File Structure

```
packages/app/dist/          # Static build output
├── index.html              # Main HTML with OPENSACIA title
├── assets/                 # JS, CSS, and other assets
└── favicon-*               # Icon files
```

## Next Steps

After Phase 1 completion, the roadmap includes:

- **Phase 2:** Integrate local inference (Ollama)
- **Phase 3:** Migrate from GitHub to GitLab
- **Phase 4:** Security auditor specialization
- **Phase 5:** CI/CD orchestration and Zero Trust hardening
- **Phase 6:** Testing and deployment

## References

- Design Document: `docs/plans/2026-03-04-opensacia-phase1-design.md`
- Implementation Plan: `docs/plans/2026-03-04-opensacia-phase1-implementation.md`
- Upstream: https://github.com/anomalyco/opencode
