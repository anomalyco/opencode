# OpenAI-Compatible Provider SDK

Custom OpenAI-compatible provider implementations for OpenCode.

## Purpose

1. **GitHub Copilot** - Provider for GitHub Copilot models
2. **Reasoning Models** - Wrapper that handles `reasoning_content` field from OpenAI-compatible APIs

## Reasoning Provider (`@ai-sdk/openai-compatible-reasoning`)

### What It Does

Detects and transforms `reasoning_content` fields from OpenAI-compatible API responses into proper reasoning events that OpenCode displays as collapsible thinking blocks.

**Important**: This only works with **OpenAI-compatible API endpoints**. Some models offer OpenAI-compatible endpoints even if they have their own native API.

### Supported Models

When accessed via OpenAI-compatible APIs:
- **DeepSeek** models (via DeepInfra or DeepSeek's OpenAI-compatible endpoint)
- **Qwen Thinking** models (via DeepInfra or compatible providers)
- **Kimi K2 Thinking** (via compatible providers)
- Any model that returns `reasoning_content` in streaming chunks

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
