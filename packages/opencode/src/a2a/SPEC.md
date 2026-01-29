# A2A Remote Agents Specification

This document describes OpenCode's implementation of the Agent-to-Agent (A2A) protocol for invoking remote agents.

## Overview

OpenCode supports invoking remote agents using the `@domain.com` syntax. Remote agents are external services that implement the A2A protocol, allowing OpenCode to delegate tasks to specialized agents hosted elsewhere.

## Agent References

Remote agents are referenced using the `@` prefix followed by a domain or domain/path:

- `@domain.com` - Default agent at domain (fetches `/.well-known/a2a/agent-card`)
- `@domain.com/path` - Specific agent at path (fetches `/path/agent-card.json`)

Examples:
- `@vercel.com` - Vercel's default agent
- `@vercel.com/deploy-agent` - Vercel's deploy-specific agent
- `@localhost:3000` - Local development agent

## Configuration

### Permission-Based Configuration (Recommended)

Configure remote agent access via the `permission.remote_agent` field:

```jsonc
{
  "permission": {
    "remote_agent": {
      // Explicitly allowed - auto-discovered and no prompt on use
      "trusted.internal.com": "allow",
      "vercel.com/deploy-agent": "allow",

      // Explicitly denied - blocks all access
      "blocked.com": "deny",

      // Wildcard patterns (last matching rule wins)
      "*.internal.corp": "allow",
      "*": "ask"  // Default: prompt user
    }
  }
}
```

**Actions:**
- `"allow"` - Auto-discover agent, no prompt on invocation
- `"deny"` - Block agent, throws DeniedError
- `"ask"` - Prompt user for approval on first use (default)

**Rule Order:** Rules are evaluated in order; the last matching rule wins. Put specific rules after general ones.

### Legacy Configuration

For backwards compatibility, `remoteAgents.domains` is still supported:

```jsonc
{
  "remoteAgents": {
    "domains": ["trusted.com", "also-trusted.com"]
  }
}
```

Domains listed here are treated as `"allow"`.

## Auto-Discovery

On startup (and when config changes), OpenCode automatically discovers agents from:

1. Domains/paths with `"allow"` action in `permission.remote_agent` (excludes wildcards)
2. Domains in `remoteAgents.domains`

Discovered agents:
- Appear in `@` autocomplete
- Show their description from the agent card
- Indicate if authentication is required: "(requires auth)"

## Authentication (OAuth)

Some remote agents require OAuth authentication. OpenCode supports OAuth 2.0 with PKCE.

### Flow

1. On first invocation, if agent requires OAuth and no valid tokens exist:
   - User is prompted to authorize
   - Browser opens to OAuth provider's authorization URL
   - Local callback server receives the authorization code
   - Code is exchanged for access/refresh tokens

2. Tokens are stored securely (mode 0600)

3. On subsequent invocations:
   - Valid tokens are used automatically
   - Expired tokens are refreshed using the refresh token

### Token Storage

Auth tokens use layered loading with project-level precedence:

| Source | Location | Precedence |
|--------|----------|------------|
| Project | `.opencode/a2a-auth.json` | Higher (overrides user) |
| User | `~/.opencode/data/a2a-auth.json` | Lower (base layer) |

**Read behavior:** Merges both sources; project tokens override user tokens for the same domain.

**Write behavior:** New tokens always written to user level (`~/.opencode/data/a2a-auth.json`).

This allows:
- Teams to share project-level tokens (e.g., CI service accounts)
- Users to maintain personal tokens that work across projects

Per-domain storage includes:
- `accessToken` - Bearer token for API calls
- `refreshToken` - Token for obtaining new access tokens
- `expiresAt` - Timestamp when access token expires
- `scope` - Granted OAuth scopes

## Trust Model

Trust is evaluated in this order:

1. **Session trust** - Domain approved during current session (highest priority)
2. **Permission config** - Rules in `permission.remote_agent`
3. **Legacy config** - Domains in `remoteAgents.domains`
4. **Default** - `"ask"` (prompt user)

Once a user approves a domain during a session, it's trusted for the remainder of that session.

## Agent Card

Remote agents expose their capabilities via an agent card (JSON):

```json
{
  "name": "Deploy Agent",
  "description": "Deploys applications to Vercel",
  "url": "https://vercel.com/a2a",
  "version": "1.0.0",
  "protocolVersion": "1.0",
  "capabilities": {
    "streaming": true
  },
  "skills": [
    {
      "id": "deploy",
      "name": "Deploy",
      "description": "Deploy an application",
      "tags": ["deployment", "vercel"]
    }
  ],
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "securitySchemes": {
    "oauth2": {
      "type": "oauth2",
      "flows": {
        "authorizationCode": {
          "authorizationUrl": "https://vercel.com/oauth/authorize",
          "tokenUrl": "https://vercel.com/oauth/token",
          "scopes": {}
        }
      }
    }
  },
  "security": [{ "oauth2": [] }]
}
```

## Implementation Files

| File | Purpose |
|------|---------|
| `src/a2a/agent-card.ts` | Agent card fetching and parsing |
| `src/a2a/client.ts` | A2A SDK client wrapper |
| `src/a2a/trust.ts` | Trust checking (allow/deny/ask) |
| `src/a2a/discovery.ts` | Auto-discovery of configured agents |
| `src/a2a/context.ts` | Conversation context tracking |
| `src/a2a/oauth/flow.ts` | OAuth 2.0 + PKCE implementation |
| `src/a2a/oauth/storage.ts` | Secure token storage |
| `src/tool/task.ts` | Remote agent execution in Task tool |
| `src/agent/agent.ts` | Agent registration (includes discovered remote agents) |
| `src/config/config.ts` | Configuration schema |

## Future Work

- [ ] Experimental flag to gate A2A features
- [ ] Nickname/alias support (e.g., `@deploy` → `vercel.com/deploy-agent`)
