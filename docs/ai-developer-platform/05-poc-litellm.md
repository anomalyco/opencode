# PoC Guide: LiteLLM Local Setup

## Overview

This guide walks you through setting up LiteLLM locally and integrating it with OpenCode. By the end, you'll have:

1. LiteLLM running in Docker
2. Multiple LLM providers configured
3. OpenCode routing through the gateway
4. Basic monitoring and logging

**Time Required**: ~30 minutes

## Prerequisites

- Docker and Docker Compose installed
- At least one LLM API key (OpenAI, Anthropic, etc.)
- OpenCode installed (`npm i -g opencode-ai`)

## Step 1: Create Project Structure

```bash
mkdir litellm-poc && cd litellm-poc

# Create necessary files
touch docker-compose.yml
touch litellm-config.yaml
touch .env
```

## Step 2: Configure Environment Variables

Edit `.env`:

```bash
# LiteLLM Master Key (for admin access)
LITELLM_MASTER_KEY=sk-master-key-change-me

# Salt key for encrypting stored API keys
LITELLM_SALT_KEY=your-random-salt-key-here

# LLM Provider API Keys (add the ones you have)
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key

# Optional: Additional providers
# AZURE_API_KEY=your-azure-key
# AZURE_API_BASE=https://your-deployment.openai.azure.com
# GOOGLE_API_KEY=your-google-key
```

## Step 3: Create LiteLLM Config

Edit `litellm-config.yaml`:

```yaml
# Model Configuration
model_list:
  # OpenAI Models
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      max_tokens: 128000

  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY

  # Anthropic Models
  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY
    model_info:
      max_tokens: 200000

  - model_name: claude-haiku
    litellm_params:
      model: anthropic/claude-3-5-haiku-latest
      api_key: os.environ/ANTHROPIC_API_KEY

# General Settings
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: postgresql://postgres:postgres@db:5432/litellm

# LiteLLM Settings
litellm_settings:
  # Enable caching (uses in-memory by default)
  cache: true
  cache_params:
    type: local
    ttl: 3600 # 1 hour

  # Request timeout
  request_timeout: 300

  # Drop sensitive params from logs
  drop_params: true

  # Callbacks for logging
  success_callback: ["langfuse"]
  failure_callback: ["langfuse"]

# Router Settings (for load balancing)
router_settings:
  routing_strategy: simple-shuffle
  num_retries: 3
  retry_after: 5
```

## Step 4: Create Docker Compose

Edit `docker-compose.yml`:

```yaml
version: "3.8"

services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    container_name: litellm-gateway
    ports:
      - "4000:4000"
    environment:
      - LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
      - LITELLM_SALT_KEY=${LITELLM_SALT_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/litellm
    volumes:
      - ./litellm-config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--port", "4000", "--num_workers", "4"]
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    container_name: litellm-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: litellm
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
```

## Step 5: Start LiteLLM

```bash
# Start the services
docker compose up -d

# Check logs
docker compose logs -f litellm

# Wait for "Application startup complete"
```

## Step 6: Verify LiteLLM is Running

```bash
# Check health
curl http://localhost:4000/health

# Expected: {"status":"healthy"}

# List available models
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-master-key-change-me"

# Test a completion
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-master-key-change-me" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Step 7: Access LiteLLM UI

Open your browser to: http://localhost:4000/ui

Login with:

- **Username**: admin
- **Password**: (your LITELLM_MASTER_KEY)

From the UI you can:

- Create virtual API keys
- View usage statistics
- Monitor requests
- Manage models

## Step 8: Create a Virtual Key

Virtual keys allow you to:

- Track usage per user/team
- Set rate limits
- Restrict model access

```bash
# Create a virtual key via API
curl -X POST http://localhost:4000/key/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-master-key-change-me" \
  -d '{
    "key_alias": "opencode-test",
    "duration": "30d",
    "models": ["gpt-4o", "gpt-4o-mini", "claude-sonnet"],
    "max_budget": 10.0,
    "tpm_limit": 100000,
    "rpm_limit": 100
  }'

# Save the returned key (starts with sk-)
```

## Step 9: Configure OpenCode

Create or edit `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "gateway": {
      "type": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:4000/v1",
        "apiKey": "sk-your-virtual-key-from-step-8"
      },
      "models": {
        "gpt-4o": {
          "name": "GPT-4o (via Gateway)",
          "contextWindow": 128000,
          "maxOutput": 16384,
          "cost": {
            "input": 2.5,
            "output": 10
          }
        },
        "claude-sonnet": {
          "name": "Claude Sonnet (via Gateway)",
          "contextWindow": 200000,
          "maxOutput": 8192,
          "cost": {
            "input": 3,
            "output": 15
          }
        }
      }
    }
  },
  "model": "gateway/gpt-4o",
  "disabled_providers": ["openai", "anthropic"]
}
```

## Step 10: Test with OpenCode

```bash
# Start OpenCode
opencode

# Your requests should now route through LiteLLM
# Check the LiteLLM UI to see request logs
```

## Step 11: Monitor Usage

### Via UI

Navigate to http://localhost:4000/ui and check:

- **Usage** tab for token counts
- **Logs** tab for request history
- **Keys** tab for per-key usage

### Via API

```bash
# Get spend for a key
curl http://localhost:4000/key/info \
  -H "Authorization: Bearer sk-master-key-change-me" \
  -d '{"key": "sk-your-virtual-key"}'

# Get global spend
curl http://localhost:4000/global/spend \
  -H "Authorization: Bearer sk-master-key-change-me"
```

## Advanced Configuration

### Add Fallback Models

Update `litellm-config.yaml` to add fallbacks:

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
    model_info:
      id: gpt-4o-primary

  # Fallback to Azure if OpenAI fails
  - model_name: gpt-4o
    litellm_params:
      model: azure/gpt-4o
      api_base: os.environ/AZURE_API_BASE
      api_key: os.environ/AZURE_API_KEY
    model_info:
      id: gpt-4o-azure-fallback

router_settings:
  routing_strategy: simple-shuffle
  num_retries: 3
  fallbacks: [{ "gpt-4o-primary": ["gpt-4o-azure-fallback"] }]
```

### Add Redis Caching

For production, use Redis instead of in-memory cache:

```yaml
# docker-compose.yml - add redis service
services:
  redis:
    image: redis:7-alpine
    container_name: litellm-redis
    ports:
      - "6379:6379"
    restart: unless-stopped

# litellm-config.yaml - update cache config
litellm_settings:
  cache: true
  cache_params:
    type: redis
    host: redis
    port: 6379
    ttl: 3600
```

### Add Rate Limiting

```yaml
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY

  # Global rate limits
  global_max_parallel_requests: 1000

litellm_settings:
  # Per-user limits (applied via virtual keys)
  max_parallel_requests: 100
```

## Troubleshooting

### LiteLLM won't start

```bash
# Check logs
docker compose logs litellm

# Common issues:
# - Invalid YAML in config
# - Missing environment variables
# - Database connection failed
```

### "Model not found" error

```bash
# List available models
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-master-key-change-me"

# Verify model name matches exactly in OpenCode config
```

### Slow responses

```bash
# Check if caching is working
curl http://localhost:4000/cache/ping \
  -H "Authorization: Bearer sk-master-key-change-me"

# Check database performance
docker compose exec db psql -U postgres -c "SELECT * FROM pg_stat_activity;"
```

### OpenCode can't connect

1. Verify LiteLLM is running: `curl http://localhost:4000/health`
2. Check firewall allows localhost:4000
3. Verify API key in OpenCode config

## Cleanup

```bash
# Stop services
docker compose down

# Remove volumes (deletes data)
docker compose down -v

# Remove all
docker compose down -v --rmi all
```

## Next Steps

After successful PoC:

1. **Security**: Move to enterprise network, add TLS
2. **Auth**: Integrate with corporate SSO
3. **Scale**: Add load balancer, multiple instances
4. **Monitor**: Connect to Datadog/Prometheus

See [Phase 1: AI Gateway + SSO](./01-phase1-gateway-sso.md) for production implementation details.

## Resources

- [LiteLLM Documentation](https://docs.litellm.ai/)
- [LiteLLM GitHub](https://github.com/BerriAI/litellm)
- [LiteLLM Config Reference](https://docs.litellm.ai/docs/proxy/configs)
- [OpenCode Provider Documentation](https://opencode.ai/docs/providers)
