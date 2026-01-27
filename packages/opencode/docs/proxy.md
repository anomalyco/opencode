# Proxy Configuration

OpenCode supports HTTP/HTTPS proxy configuration for environments that require outbound traffic to go through a corporate proxy.

## Quick Start

Set the environment variables before running OpenCode:

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
export HTTP_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1,*.internal.com

opencode
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `HTTPS_PROXY` | Proxy URL for HTTPS requests | `http://proxy:8080` |
| `HTTP_PROXY` | Proxy URL for HTTP requests | `http://proxy:8080` |
| `NO_PROXY` | Comma-separated list of hosts to bypass | `localhost,*.internal.com` |
| `https_proxy` | Alternative (lowercase) | Same as above |
| `http_proxy` | Alternative (lowercase) | Same as above |
| `no_proxy` | Alternative (lowercase) | Same as above |
| `OPENCODE_DISABLE_PROXY` | Emergency bypass flag | `1` to disable |

## Configuration File

You can also configure proxy settings in `opencode.json`:

```json
{
  "proxy": {
    "http": "http://proxy.example.com:8080",
    "https": "http://proxy.example.com:8080",
    "no_proxy": ["localhost", "127.0.0.1", "*.internal.com"]
  }
}
```

**Priority Order:**
1. Configuration file (`opencode.json`) - highest priority
2. Environment variables - fallback

## NO_PROXY Patterns

The `NO_PROXY` / `no_proxy` setting supports these patterns:

| Pattern | Description | Example |
|---------|-------------|---------|
| `*` | Bypass all hosts (disable proxy) | `*` |
| `hostname` | Exact match or suffix match | `localhost` |
| `*.domain.com` | Wildcard subdomain match | `*.internal.com` |
| `.domain.com` | Suffix match (subdomains only) | `.ft.intra` |
| `192.168.1.100` | Exact IP match | - |

### Examples

```bash
# Bypass proxy for localhost and internal networks
NO_PROXY=localhost,127.0.0.1,*.internal.com,.ft.intra

# Bypass proxy for all hosts (emergency)
NO_PROXY=*
```

## Proxy URL Format

Standard proxy URL format:

```
http://[user:password@]host:port
```

**Examples:**
```bash
# Without authentication
HTTPS_PROXY=http://proxy.example.com:8080

# With authentication
HTTPS_PROXY=http://user:password@proxy.example.com:8080
```

## Emergency Bypass

If the proxy configuration causes issues, you can temporarily disable it:

```bash
OPENCODE_DISABLE_PROXY=1 opencode
```

This bypasses all proxy settings and uses direct connections.

## What Uses the Proxy

All HTTP/HTTPS requests made by OpenCode go through the proxy when configured:

- Model API calls (Anthropic, OpenAI, etc.)
- Provider authentication (OAuth flows)
- Version check and auto-update
- LSP language server downloads
- MCP server connections (HTTP/SSE transports)
- Web fetch/search tools
- GitHub API integration
- Share functionality

## Limitations

- **WebSocket connections**: Not proxied (Bun limitation)
- **Local MCP servers**: stdio-based servers are not affected

## Troubleshooting

### Proxy not being used

1. Check if the environment variable is set:
   ```bash
   echo $HTTPS_PROXY
   ```

2. Verify the URL format is correct (must include `http://`)

3. Check if the host is in NO_PROXY:
   ```bash
   echo $NO_PROXY
   ```

### SSL/TLS errors through proxy

Some corporate proxies perform SSL interception. You may need to:

1. Configure the proxy's CA certificate in your system trust store
2. Set `NODE_TLS_REJECT_UNAUTHORIZED=0` (not recommended for production)

### Proxy authentication failing

Ensure special characters in password are URL-encoded:

```bash
# Password with @ symbol
HTTPS_PROXY=http://user:p%40ssword@proxy.example.com:8080
```

## Example Configurations

### Corporate Proxy (France Travail)

```bash
export HTTPS_PROXY=http://proxyaws.pole-emploi.intra:8080
export HTTP_PROXY=http://proxyaws.pole-emploi.intra:8080
export NO_PROXY=localhost,127.0.0.1,*.pole-emploi.intra,*.ft.intra
```

### Docker with Proxy

```dockerfile
ENV HTTPS_PROXY=http://proxy.example.com:8080
ENV HTTP_PROXY=http://proxy.example.com:8080
ENV NO_PROXY=localhost,127.0.0.1
```

### CI/CD Pipeline

```yaml
# GitLab CI
variables:
  HTTPS_PROXY: http://proxy.example.com:8080
  NO_PROXY: localhost,127.0.0.1,*.internal.com

# GitHub Actions
env:
  HTTPS_PROXY: http://proxy.example.com:8080
  NO_PROXY: localhost,127.0.0.1
```
