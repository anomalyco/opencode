---
name: hermes-swarm
description: Configure and use hermes-swarm - a cost-effective agent using free/cheap AI models. Use when the user wants to set up, configure, or troubleshoot hermes-swarm, or when cost-effective AI operations are needed.
---

# Hermes-Swarm

Hermes-swarm is a configurable variant of hermes-code that uses **free/cheap AI models** for cost-effective operations.

## Quick Setup

### 1. Apply the Patch (on hermes server)

```bash
scp patch_api_server_hermes_swarm.py tusker@10.0.0.231:/srv/opencode/hermes-agent/
ssh tusker@10.0.0.231
cd /srv/opencode/hermes-agent
python patch_api_server_hermes_swarm.py
```

### 2. Configure Environment Variables

Edit `~/.hermes/.env`:

```bash
# Primary model (GPT-5-Mini via GitHub Copilot - FREE with subscription)
HERMES_SWARM_PRIMARY_MODEL=github-copilot/gpt-5-mini

# Selection policy
HERMES_SWARM_SELECTION_POLICY=cost-balanced

# API Keys
OPENROUTER_API_KEY=sk_or_your_key_here
GITHUB_COPILOT_API_KEY=your_github_copilot_token
```

### 3. Restart and Verify

```bash
docker-compose restart
curl -s http://hermes.tusker.net.au:8642/v1/models | grep hermes-swarm
```

## Available Models

### Free Tier

| Provider | Model | Cost |
|----------|-------|------|
| GitHub Copilot | `gpt-5-mini` | FREE with subscription |
| OpenRouter | `llama-3-8b-instruct` | FREE |
| OpenRouter | `mistral-7b-instruct` | FREE |
| OpenRouter | `openchat-3.5-0108` | FREE |
| OpenRouter | `openai/gpt-3.5-turbo` | ~$0.5/1M tokens |
| Local Ollama | `llama3` | FREE (local) |

### Recommended Configuration

```bash
HERMES_SWARM_PRIMARY_MODEL=github-copilot/gpt-5-mini
HERMES_SWARM_FALLBACKS=openrouter/auto,openrouter/meta-llama/llama-3-8b-instruct,openrouter/mistralai/mistral-7b-instruct
```

## Usage

### API Call

```bash
curl -X POST http://hermes.tusker.net.au:8642/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hermes-swarm",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### OpenCode TUI

Connect to `hermes.tusker.net.au` and select `hermes-swarm` model.

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `HERMES_SWARM_PRIMARY_MODEL` | `github-copilot/gpt-5-mini` | Primary model |
| `HERMES_SWARM_SELECTION_POLICY` | `cost-balanced` | `cost-balanced`, `round-robin`, `specific-order` |
| `HERMES_SWARM_MAX_TOKENS` | `4000` | Max tokens per request |
| `HERMES_SWARM_DAILY_TOKEN_LIMIT` | `50000` | Daily token budget |
| `OPENROUTER_API_KEY` | - | OpenRouter API key |
| `GITHUB_COPILOT_API_KEY` | - | GitHub Copilot token |

## Troubleshooting

**Model not found:**
- Verify `hermes-swarm` appears in `/v1/models`
- Check API keys are set correctly

**High latency:**
- Use `openrouter/auto` for automatic best-free-model selection
- Consider local Ollama for zero-latency inference

**Cost issues:**
- Set `HERMES_SWARM_DAILY_TOKEN_LIMIT` for budget control
- Use `selection_policy=cost-balanced` to prefer free models

## Cost Comparison

| Model | Input $/1M | Output $/1M |
|-------|------------|-------------|
| hermes-code (claude-opus) | ~$15 | ~$75 |
| hermes-swarm (gpt-3.5-turbo) | ~$0.5 | ~$1.5 |
| hermes-swarm (llama-3-8b) | FREE | FREE |

**Savings:** ~95-99% on API costs