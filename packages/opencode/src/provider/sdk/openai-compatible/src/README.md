# OpenAI-Compatible Provider SDK

Custom OpenAI-compatible provider implementations for OpenCode.

## Purpose

1. **GitHub Copilot** - Provider for GitHub Copilot models
2. **Reasoning Models** - Wrapper that handles `reasoning_content` field from models served via OpenAI-compatible APIs

## Reasoning Provider (`@ai-sdk/openai-compatible-reasoning`)

### What It Does

Detects and transforms `reasoning_content` fields from OpenAI-compatible API responses into proper reasoning events that OpenCode displays as collapsible thinking blocks.

**Important**: This only works with **OpenAI-compatible API endpoints**. Some providers serve models via OpenAI-compatible APIs even if those models have their own native APIs.

### Supported Models

When served via OpenAI-compatible APIs:
- **DeepSeek** (via DeepInfra or DeepSeek's OpenAI-compatible endpoint)
- **Qwen Thinking** (via DeepInfra or other providers)
- **Kimi K2 Thinking** (via providers offering OpenAI-compatible APIs)
- Any model served via OpenAI-compatible APIs that returns `reasoning_content`

### Configuration

```json
{
  "provider": {
    "deepinfra-thinking": {
      "npm": "@ai-sdk/openai-compatible-reasoning",
      "options": {
        "baseURL": "https://api.deepinfra.com/v1/openai",
        "reasoning": { "enabled": true }
      },
      "models": {
        "deepseek-ai/DeepSeek-V3.2": {}
      }
    }
  }
}
```

**Note**: `reasoning.enabled` is required for some models (e.g., DeepSeek) but not others (e.g., Qwen).

## How It Works

Response chunks with `delta.reasoning_content` are transformed into:
- `reasoning-start` → `reasoning-delta` → `reasoning-end` events
- OpenCode's processor displays these as collapsible thinking blocks
- All request handling (including multimodal input) is delegated to the base model

## Files

- `openai-compatible-provider.ts` - Provider factory
- `openai-compatible-chat-reasoning-model.ts` - Reasoning wrapper
- `index.ts` - Exports
