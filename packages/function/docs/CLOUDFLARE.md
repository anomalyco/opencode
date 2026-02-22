# Wrangler Configuration Setup

This document outlines the complete wrangler.jsonc configurations for the OpenCode project.

## Overview

The OpenCode project consists of multiple Cloudflare Workers, each serving different purposes:

1. **Gateway Worker** (`gateway/wrangler.jsonc`) - Main agent orchestration system
2. **API Worker** (`packages/function/wrangler.jsonc`) - REST API and session management
3. **Web Worker** (`packages/web/wrangler.jsonc`) - Static asset serving
4. **Session Viewer** (`gateway/wrangler.viewer.jsonc`) - Session browsing interface
5. **Cloudflare Gateway** (`gateway/wrangler.cloudflare.jsonc`) - D1-based gateway

## Configuration Details

### 1. Gateway Worker (Agent System)

**File:** `gateway/wrangler.jsonc`
**Purpose:** Main agent orchestration with Durable Objects

**Key Bindings:**

- `AGENTS`: Durable Object namespace for individual agents
- `ORCHESTRATOR`: Durable Object for the orchestrator agent
- `SESSION_STORAGE`: R2 bucket for session persistence
- `AI`: Workers AI binding for model inference
- `AI_GATEWAY`: AI Gateway for monitoring and rate limiting

### 2. API Worker (REST API)

**File:** `packages/function/wrangler.jsonc`
**Purpose:** REST API endpoints and session synchronization

**Key Bindings:**

- `SYNC_SERVER`: Durable Object for real-time session sync
- `Bucket`: R2 bucket for shared storage
- `WEB_DOMAIN`: Environment variable for CORS

### 3. Web Worker (Static Assets)

**File:** `packages/web/wrangler.jsonc`
**Purpose:** Serve static web assets and frontend

**Key Bindings:**

- `ASSETS`: Static assets binding for the dist directory
- `VITE_API_URL`: Frontend API endpoint
- `API_ACCOUNT_ID`: Cloudflare account ID

### 4. Session Viewer (Standalone)

**File:** `gateway/wrangler.viewer.jsonc`
**Purpose:** Dedicated session browsing interface

**Key Bindings:**

- `SESSION_STORAGE`: R2 bucket for session data

### 5. Cloudflare Gateway (D1)

**File:** `gateway/wrangler.cloudflare.jsonc`
**Purpose:** Alternative gateway using D1 database

**Key Bindings:**

- `DB`: D1 database for session storage

## Deployment Instructions

### Prerequisites

1. Install Wrangler CLI: `npm install -g wrangler`
2. Login: `wrangler login`
3. Set up required resources in Cloudflare dashboard

### Setup Steps

#### 1. Create Required Resources

```bash
# Create R2 buckets
wrangler r2 bucket create agent-sessions
wrangler r2 bucket create opencode-storage

# Create D1 database (for cloudflare gateway)
wrangler d1 create opencode-sessions

# Create AI Gateway (optional)
# Go to Cloudflare dashboard -> AI -> AI Gateway -> Create Gateway
```

#### 2. Configure Secrets

```bash
# For gateway worker
cd gateway
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY

# For API worker
cd packages/function
wrangler secret put GITHUB_APP_PRIVATE_KEY
```

#### 3. Deploy Workers

```bash
# Deploy gateway worker
cd gateway
wrangler deploy

# Deploy API worker
cd packages/function
wrangler deploy

# Deploy web worker
cd packages/web
npm run build
wrangler deploy

# Deploy session viewer (optional)
cd gateway
wrangler deploy --config wrangler.viewer.jsonc

# Deploy cloudflare gateway (optional)
cd gateway
wrangler deploy --config wrangler.cloudflare.jsonc
```

## Environment Variables

### Required Variables

- `WEB_DOMAIN`: Domain for CORS configuration
- `VITE_API_URL`: Frontend API endpoint
- `API_ACCOUNT_ID`: Cloudflare account ID

### Secrets

- `ANTHROPIC_API_KEY`: Anthropic API key for Claude
- `OPENAI_API_KEY`: OpenAI API key for GPT models
- `GITHUB_APP_PRIVATE_KEY`: GitHub App private key for authentication

## Routes Configuration

Each worker is configured with specific routes:

- **Gateway**: `api.opencode.j9xym.com/agents/*`
- **API**: `api.opencode.j9xym.com/*`
- **Web**: `opencode.j9xym.com/*`
- **Session Viewer**: `sessions.opencode.j9xym.com/*`
- **Cloudflare Gateway**: `gateway.opencode.j9xym.com/*`

## Development

### Local Development

```bash
# Start gateway locally
cd gateway
wrangler dev

# Start API locally
cd packages/function
wrangler dev

# Start web locally
cd packages/web
npm run dev
```

### Testing

```bash
# Test gateway endpoints
curl -X POST https://api.opencode.j9xym.com/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "test-agent", "agent_type: "test"}'

# Test session viewer
curl https://sessions.opencode.j9xym.com/
```

## Troubleshooting

### Common Issues

1. **Missing Bindings**: Ensure all R2 buckets, D1 databases, and secrets are created
2. **CORS Issues**: Check `WEB_DOMAIN` environment variable matches your domain
3. **Permission Errors**: Verify API keys and GitHub app installation
4. **Type Errors**: Install TypeScript types for Cloudflare Workers

### Debug Commands

```bash
# Check worker logs
wrangler tail

# Check bindings
wrangler config list

# Validate configuration
wrangler deploy --dry-run
```

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Worker    │    │   API Worker    │    │ Gateway Worker  │
│   (Static)      │◄──►│   (REST API)    │◄──►│   (Agents)      │
│   opencode-web  │    │ opencode-api    │    │ opencloudcode   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Session Viewer  │    │   R2 Storage    │    │   Durable       │
│   (Optional)    │    │   (Sessions)    │    │   Objects       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Migration Notes

When updating configurations:

1. Always backup existing workers
2. Test changes in staging environment first
3. Update secrets and environment variables as needed
4. Monitor logs after deployment
