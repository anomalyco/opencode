# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅ Current |
| < 1.1   | ❌ EOL     |

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Please report security issues via:
1. GitHub Security Advisories: [Report a vulnerability](https://github.com/opencode-ai/opencode/security/advisories/new)
2. Email: security@opencode.ai

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **24 hours**: Acknowledgment of report
- **72 hours**: Initial assessment
- **7 days**: Fix development for critical issues
- **30 days**: Fix development for non-critical issues

## Security Measures

### Authentication
- API keys stored with restricted file permissions (0o600)
- Optional HTTP Basic Auth for server mode
- One-time tokens for WebSocket authentication
- PKCE for OAuth flows

### Command Execution
- Tree-sitter AST parsing for command analysis
- Dangerous shell pattern blocking (injection prevention)
- User permission approval required for each command
- Environment variable whitelist (sensitive vars not leaked)

### MCP Integration
- Tool response sanitization (prompt injection prevention)
- Response size limits (1MB)
- Content type filtering
- Connection timeouts

### File Operations
- Atomic file writes with locking
- Symlink attack prevention
- Path traversal protection
- External directory access controls

### Network
- Rate limiting (200 req/min)
- CORS restrictions (localhost + approved domains only)
- Security headers (X-Content-Type-Options, X-Frame-Options)
- No credentials in cross-origin requests

### CI/CD
- Semgrep SAST scanning
- TruffleHog secret detection
- Dependency vulnerability scanning via Dependabot
- Automated security scans on PRs

## Security Architecture

```
User Input → Permission Check → Sanitization → Execution → Output Sanitization → LLM
```

All user-facing operations pass through:
1. **Permission layer** (explicit user approval)
2. **Input sanitization** (dangerous pattern blocking)
3. **Sandboxed execution** (path containment, env whitelist)
4. **Output sanitization** (prompt injection prevention)
