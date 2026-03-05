# OPENSACIA Phase 2: Local Inference Integration Design

**Date:** 2026-03-05
**Author:** Victor Gonzalez (vicorente)
**Status:** Approved
**Related Issue:** N/A

## Overview

This document establishes the design for Phase 2 of OPENSACIA: integrating Ollama as a first-class citizen provider for local inference while maintaining multi-provider flexibility.

**Repository:** https://github.com/vicorente/OPENSACIA
**Upstream:** https://github.com/anomalyco/opencode

## Architecture

### LLM Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OPENSACIA LLM Layer                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Ollama    │  │   Google    │  │    Anthropic        │ │
│  │  (Local)    │  │  (Antigrav) │  │    (Optional)       │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│         ↓                 ↓                    ↓            │
│  ┌───────────────────────────────────────────────────────┐ │
│  │         Provider Abstraction Layer (@ai-sdk)          │ │
│  └───────────────────────────────────────────────────────┘ │
│                              ↓                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Session / Agent Logic                     │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Configuration Hierarchy

1. `~/.config/opensacia/config.json` (user override)
2. `packages/opencode/src/config/defaults.json` (default values)
3. Environment variables (highest priority)

## Components to Modify/Add

### 2.1 Default Configuration (New File)

**Create:** `packages/opencode/src/config/defaults.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": {
        "qwen2.5:7b-instruct-q5_K_M": {
          "name": "Qwen2.5 7B Instruct (Local)",
          "tools": true,
          "limit": {
            "context": 32768,
            "output": 4096
          }
        }
      }
    }
  }
}
```

### 2.2 Rename Configuration Directory

**Change:** `~/.config/opencode/` → `~/.config/opensacia/`

**Files to modify:**
- `packages/opencode/src/global/path.ts` - Config path
- `packages/opencode/src/config/config.ts` - Config loading

### 2.3 Ollama Health Check (New)

**Create:** `packages/opencode/src/provider/ollama/health.ts`

```typescript
export async function checkOllamaConnection(baseURL: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseURL}/models`)
    return response.ok
  } catch {
    return false
  }
}
```

### 2.4 Environment Variables

**Add in `packages/opencode/src/flag/flag.ts`:**

```typescript
export const OPENSACIA_OLLAMA_BASE_URL =
  process.env["OPENSACIA_OLLAMA_BASE_URL"] ?? "http://localhost:11434/v1"
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    User Request                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│         Config Layer (config.json + defaults)               │
│  - Reads selected provider                                  │
│  - If "ollama", uses OPENSACIA_OLLAMA_BASE_URL              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│         Provider SDK (@ai-sdk/openai-compatible)            │
│  - Creates client with configured baseURL                    │
│  - Prepares messages + tools                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│         Ollama Server (localhost:11434/v1)                  │
│  - Processes with qwen2.5:7b-instruct-q5_K_M model           │
│  - Returns response with tool_calls                         │
└─────────────────────────────────────────────────────────────┘
```

## Error Handling & Edge Cases

### Scenarios

| Scenario | Behavior |
|----------|----------|
| Ollama unavailable | Clear error with instructions to start Ollama |
| Model not found | Suggest: `ollama pull qwen2.5:7b-instruct-q5_K_M` |
| Local inference timeout | Configurable, default 120s |
| Tool Calling unsupported | Warning + continue without tools |
| Context window exceeded | Error with max allowed size |

### Startup Validation

```typescript
// If Ollama is configured as provider
if (config.provider?.ollama && !await checkOllamaConnection(baseURL)) {
  log.warn("Ollama not reachable", {
    baseURL,
    hint: "Run: ollama serve"
  })
  // Don't fail, allow other providers
}
```

### Hybrid Configuration

Users can configure multiple providers:

```json
{
  "provider": {
    "ollama": { ... },
    "anthropic": { ... }
  }
}
```

And select which one to use per session.

## Testing & Validation

### Unit Tests

```typescript
// Test: Config defaults
test("ollama provider in defaults", () => {
  const defaults = loadDefaults()
  expect(defaults.provider.ollama).toBeDefined()
  expect(defaults.provider.ollama.models["qwen2.5:7b-instruct-q5_K_M"]).toBeDefined()
})

// Test: Ollama health check
test("checkOllamaConnection returns false when unreachable", async () => {
  const result = await checkOllamaConnection("http://invalid:9999")
  expect(result).toBe(false)
})
```

### Integration Tests

```bash
# Requirement: Ollama running with the model
ollama serve &
ollama pull qwen2.5:7b-instruct-q5_K_M

# Test: Tool calling
bun test --cwd packages/opencode ollama-tools.test.ts

# Test: Context window
bun test --cwd packages/opencode ollama-context.test.ts
```

### Manual Validation Checklist

| Item | Command | Expected |
|------|---------|----------|
| Ollama responds | `curl http://localhost:11434/v1/models` | JSON with models |
| Config loaded | `cat ~/.config/opensacia/config.json` | Contains provider.ollama |
| Tool calling | Session with command | Executes tools |
| Air-gapped | Disconnect network | Works same |

## Ollama Setup Reference

### Install Ollama

```bash
# macOS
curl -fsSL https://ollama.com/install.sh | sh

# Pull the model
ollama pull qwen2.5:7b-instruct-q5_K_M

# Start server
ollama serve
```

### Model Specifications

| Property | Value |
|----------|-------|
| Model | qwen2.5:7b-instruct-q5_K_M |
| Context Window | 32,768 tokens |
| Max Output | 4,096 tokens |
| Tool Calling | Supported |
| Quantization | Q5_K_M |

## Next Steps

After Phase 2 completion:

1. **Phase 3:** Migrate from GitHub to GitLab
2. **Phase 4:** Security auditor specialization
3. **Phase 5:** CI/CD orchestration and Zero Trust hardening
4. **Phase 6:** Testing and deployment

## References

- Design Document Phase 1: `docs/plans/2026-03-04-opensacia-phase1-design.md`
- Implementation Plan Phase 1: `docs/plans/2026-03-04-opensacia-phase1-implementation.md`
- Ollama Documentation: https://ollama.com/
- @ai-sdk/openai-compatible: https://www.npmjs.com/package/@ai-sdk/openai-compatible
