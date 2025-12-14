# OpenAI-Compatible Provider SDK

This package provides custom OpenAI-compatible provider implementations for OpenCode.

## Purpose

This package serves two main purposes:

1. **GitHub Copilot Compatibility** - Custom provider implementation for GitHub Copilot models
2. **Reasoning Model Support** - Extended provider wrapper that handles `reasoning_content` field for thinking/reasoning models

## Provider Types

### Standard Provider (`@ai-sdk/openai-compatible`)

Used for:
- GitHub Copilot models
- Standard OpenAI-compatible APIs that don't use reasoning

### Reasoning Provider (`@ai-sdk/openai-compatible-reasoning`)

Used for models that support the `reasoning_content` field, including:
- DeepSeek (DeepSeek-V3, DeepSeek-R1, etc.)
- Qwen Thinking models (Qwen3-235B-A22B-Thinking-2507)
- Kimi K2 Thinking
- Other OpenAI-compatible models that return reasoning in the `reasoning_content` field

## How Reasoning Support Works

### The Problem

Some OpenAI-compatible models (like DeepSeek and Qwen) return their reasoning/thinking process in a separate `reasoning_content` field in the streaming response, rather than using OpenAI's native reasoning API format.

Example response chunk:
```json
{
  "choices": [{
    "delta": {
      "role": "assistant",
      "content": null,
      "reasoning_content": "Let me think about this step by step..."
    }
  }]
}
```

### The Solution

`OpenAICompatibleChatWithReasoningLanguageModel` extends the base OpenAI-compatible provider to:

1. Intercept streaming chunks from the API
2. Detect `delta.reasoning_content` fields
3. Transform them into proper reasoning events (`reasoning-start`, `reasoning-delta`, `reasoning-end`)
4. Allow OpenCode's processor to display reasoning in collapsible UI blocks

### Configuration

To use reasoning models, configure your provider with the reasoning npm package:

```json
{
  "provider": {
    "deepinfra-thinking": {
      "npm": "@ai-sdk/openai-compatible-reasoning",
      "options": {
        "baseURL": "https://api.deepinfra.com/v1/openai",
        "reasoning": {
          "enabled": true
        }
      },
      "models": {
        "deepseek-ai/DeepSeek-V3.2": {
          "name": "DeepSeek V3.2"
        }
      }
    }
  }
}
```

### Provider Options

#### `reasoning.enabled`

Some models (like DeepSeek) require an explicit request parameter to enable reasoning output:

```json
{
  "options": {
    "reasoning": {
      "enabled": true
    }
  }
}
```

This adds `"reasoning": { "enabled": true }` to the API request body.

## Architecture

```
Raw API Response (SSE chunks)
  ↓
OpenAICompatibleChatWithReasoningLanguageModel.doStream()
  ↓
TransformStream intercepts chunks
  ↓
Detects delta.reasoning_content field
  ↓
Emits: reasoning-start → reasoning-delta(s) → reasoning-end
  ↓
OpenCode processor creates MessageV2.ReasoningPart
  ↓
UI displays as collapsible thinking blocks
```

## Compatibility

The reasoning wrapper is designed to be non-invasive:

- ✅ **Standard models**: Unaffected (no `reasoning_content` field)
- ✅ **OpenAI o1/o3**: Unaffected (use different Responses API)
- ✅ **`<think>` tag models**: Unaffected (tags in `content`, not `reasoning_content`)
- ✅ **DeepSeek/Qwen**: Properly handled via `reasoning_content` parsing

## Files

- `openai-compatible-provider.ts` - Provider factory and registration
- `openai-compatible-chat-reasoning-model.ts` - Reasoning wrapper implementation
- `index.ts` - Public exports

## When to Modify

- **Copilot-specific changes**: Safe to modify, won't affect other providers
- **Reasoning support changes**: Will affect all models using `@ai-sdk/openai-compatible-reasoning`
- **General OpenAI-compatible fixes**: Consider upstreaming to Vercel AI SDK instead
