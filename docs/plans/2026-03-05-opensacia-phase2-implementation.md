# OPENSACIA Phase 2: Local Inference Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrar Ollama como proveedor first-class citizen para inferencia local manteniendo arquitectura multi-proveedor.

**Architecture:** Mantener la abstracción de proveedores existente de OpenCode, agregar configuración por defecto para Ollama, renombrar directorio de configuración de opencode a opensacia, y agregar validación de conexión a Ollama.

**Tech Stack:** TypeScript, @ai-sdk/openai-compatible, Ollama, Node.js fetch API

---

## Task 1: Create Feature Branch

**Step 1: Create new feature branch**

Run: `git checkout -b feature/phase2-ollama-integration`

Expected: `Switched to a new branch 'feature/phase2-ollama-integration'`

---

## Task 2: Create Default Configuration File

**Files:**
- Create: `packages/opencode/src/config/defaults.json`

**Step 1: Create defaults.json with Ollama configuration**

Create `packages/opencode/src/config/defaults.json`:

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

**Step 2: Verify JSON syntax**

Run: `cat packages/opencode/src/config/defaults.json | jq .`

Expected: Valid JSON output

**Step 3: Commit**

```bash
git add packages/opencode/src/config/defaults.json
git commit -m "feat(config): add default Ollama provider configuration"
```

---

## Task 3: Update Config Path from opencode to opensacia

**Files:**
- Modify: `packages/opencode/src/global/path.ts`

**Step 1: Read current path.ts**

Read: `packages/opencode/src/global/path.ts`

Look for `opencode` in path definitions.

**Step 2: Update config directory name**

Find and replace:
- `".opencode"` → `".opensacia"`
- `"opencode"` → `"opensacia"` (in config context only, be careful not to change package names)

**Step 3: Verify syntax**

Run: `bun run --cwd packages/opencode typecheck`

Expected: No type errors

**Step 4: Commit**

```bash
git add packages/opencode/src/global/path.ts
git commit -m "feat(rebrand): rename config directory from opencode to opensacia"
```

---

## Task 4: Update Config Loading to Include Defaults

**Files:**
- Modify: `packages/opencode/src/config/config.ts`

**Step 1: Read current config.ts**

Read: `packages/opencode/src/config/config.ts`

Understand how configuration is loaded and merged.

**Step 2: Add defaults import and merge**

Look for where user config is loaded and add defaults merge:

```typescript
import defaults from "../config/defaults.json"

// In the config loading function, merge defaults before user config
const config = mergeDeep(defaults, userConfig)
```

**Step 3: Verify syntax**

Run: `bun run --cwd packages/opencode typecheck`

Expected: No type errors

**Step 4: Commit**

```bash
git add packages/opencode/src/config/config.ts
git commit -m "feat(config): merge default configuration with user config"
```

---

## Task 5: Create Ollama Health Check Module

**Files:**
- Create: `packages/opencode/src/provider/ollama/health.ts`
- Create: `packages/opencode/src/provider/ollama/index.ts`

**Step 1: Create health check module**

Create `packages/opencode/src/provider/ollama/health.ts`:

```typescript
import { Log } from "../../util/log"

const log = Log.create({ service: "ollama-health" })

export async function checkOllamaConnection(baseURL: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${baseURL}/models`, {
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (response.ok) {
      const data = await response.json()
      log.debug("Ollama connection successful", {
        modelCount: data.data?.length ?? 0
      })
      return true
    }

    log.warn("Ollama returned error", {
      status: response.status
    })
    return false
  } catch (err) {
    log.debug("Ollama connection failed", {
      error: err instanceof Error ? err.message : String(err)
    })
    return false
  }
}
```

**Step 2: Create index.ts**

Create `packages/opencode/src/provider/ollama/index.ts`:

```typescript
export * from "./health"
```

**Step 3: Verify syntax**

Run: `bun run --cwd packages/opencode typecheck`

Expected: No type errors

**Step 4: Commit**

```bash
git add packages/opencode/src/provider/ollama/
git commit -m "feat(provider): add Ollama health check module"
```

---

## Task 6: Add Ollama Environment Variable Flags

**Files:**
- Modify: `packages/opencode/src/flag/flag.ts`

**Step 1: Read flag.ts to find OPENCODE_OLLAMA_* or similar**

Run: `grep -n "OLLAMA" packages/opencode/src/flag/flag.ts`

Check if Ollama flags already exist.

**Step 2: Add OPENSACIA_OLLAMA flags**

Add after line 38 (after OPENCODE_SERVER_*):

```typescript
  // OPENSACIA: Ollama provider configuration
  export const OPENSACIA_OLLAMA_BASE_URL =
    process.env["OPENSACIA_OLLAMA_BASE_URL"] ??
    process.env["OPENCODE_OLLAMA_BASE_URL"] ??
    "http://localhost:11434/v1"
```

**Step 3: Verify syntax**

Run: `bun run --cwd packages/opencode typecheck`

Expected: No type errors

**Step 4: Commit**

```bash
git add packages/opencode/src/flag/flag.ts
git commit -m "feat(flags): add OPENSACIA_OLLAMA_BASE_URL environment variable"
```

---

## Task 7: Add Ollama Health Check on Startup

**Files:**
- Modify: `packages/opencode/src/provider/provider.ts`

**Step 1: Read provider.ts to find initialization**

Read: `packages/opencode/src/provider/provider.ts`

Look for where providers are initialized/loaded.

**Step 2: Add health check for Ollama**

Import the health check function at the top:

```typescript
import { checkOllamaConnection } from "./ollama"
```

Add health check after config is loaded (look for where provider config is processed):

```typescript
// OPENSACIA: Check Ollama connectivity if configured
if (config.provider?.ollama?.options?.baseURL) {
  const baseURL = config.provider.ollama.options.baseURL
  const isReachable = await checkOllamaConnection(baseURL)
  if (!isReachable) {
    log.warn("Ollama provider configured but not reachable", {
      baseURL,
      hint: "Ensure Ollama is running: ollama serve"
    })
  } else {
    log.info("Ollama provider connected", { baseURL })
  }
}
```

**Step 3: Verify syntax**

Run: `bun run --cwd packages/opencode typecheck`

Expected: No type errors

**Step 4: Commit**

```bash
git add packages/opencode/src/provider/provider.ts
git commit -m "feat(provider): add Ollama health check on startup"
```

---

## Task 8: Update Documentation

**Files:**
- Create: `docs/phase2-ollama-setup.md`

**Step 1: Create Ollama setup documentation**

Create `docs/phase2-ollama-setup.md`:

```markdown
# OPENSACIA Phase 2: Ollama Integration

## Ollama Setup

### Install Ollama

```bash
# macOS
curl -fsSL https://ollama.com/install.sh | sh

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download from https://ollama.com/download
```

### Pull the Model

```bash
ollama pull qwen2.5:7b-instruct-q5_K_M
```

### Start Ollama Server

```bash
ollama serve
```

By default, Ollama runs on `http://localhost:11434`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSACIA_OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama API endpoint |

### Config File

Edit `~/.config/opensacia/config.json`:

```json
{
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://localhost:11434/v1"
      }
    }
  }
}
```

## Model Specifications

| Property | Value |
|----------|-------|
| Model | qwen2.5:7b-instruct-q5_K_M |
| Context Window | 32,768 tokens |
| Max Output | 4,096 tokens |
| Tool Calling | Supported |

## Testing

### Verify Ollama is Running

```bash
curl http://localhost:11434/v1/models
```

### Test with OPENSACIA

```bash
# Start OPENSACIA
bun run packages/opencode/src/index.ts serve

# In a session, the Ollama provider should be available
```

## Troubleshooting

### "Ollama not reachable" error

- Ensure Ollama is running: `ollama serve`
- Check the endpoint: `curl http://localhost:11434/v1/models`
- Verify the baseURL in config matches Ollama's endpoint

### Model not found

```bash
ollama pull qwen2.5:7b-instruct-q5_K_M
```

### Tool calling not working

Ensure the model configuration has `"tools": true` set.
```

**Step 2: Commit**

```bash
git add docs/phase2-ollama-setup.md
git commit -m "docs: add Ollama setup and configuration guide"
```

---

## Task 9: Create Unit Tests for Ollama Health Check

**Files:**
- Create: `packages/opencode/test/provider/ollama/health.test.ts`

**Step 1: Create test file**

Create `packages/opencode/test/provider/ollama/health.test.ts`:

```typescript
import { describe, test, expect, mock } from "bun:test"
import { checkOllamaConnection } from "../../src/provider/ollama"

describe("Ollama Health Check", () => {
  test("returns true when Ollama is reachable", async () => {
    // Note: This test requires Ollama to be running
    // Skip in CI or use mock
    const result = await checkOllamaConnection("http://localhost:11434/v1")
    // Result depends on whether Ollama is running
    expect(typeof result).toBe("boolean")
  })

  test("returns false when endpoint is unreachable", async () => {
    const result = await checkOllamaConnection("http://invalid:9999/v1")
    expect(result).toBe(false)
  })

  test("returns false when endpoint returns error", async () => {
    const result = await checkOllamaConnection("http://localhost:11434/invalid")
    expect(result).toBe(false)
  })
})
```

**Step 2: Run tests**

Run: `bun test packages/opencode/test/provider/ollama/health.test.ts`

Expected: Tests pass (some may fail if Ollama is not running)

**Step 3: Commit**

```bash
git add packages/opencode/test/provider/ollama/
git commit -m "test(provider): add Ollama health check unit tests"
```

---

## Task 10: Manual Integration Testing

**Step 1: Ensure Ollama is running**

Run: `curl -s http://localhost:11434/v1/models | jq .`

Expected: JSON response with models array

**Step 2: Start OPENSACIA server**

Run: `bun run packages/opencode/src/index.ts serve`

Expected: Server starts, log shows "Ollama provider connected" or warning

**Step 3: Create a test session**

Run: `bun run packages/opencode/src/index.ts run`

In the session, test basic functionality with the Ollama provider.

**Step 4: Verify tool calling works**

Test a command that uses tools (e.g., file operations).

**Step 5: Check logs**

Verify that requests go to Ollama and responses include tool calls.

---

## Task 11: Final Validation and Push

**Step 1: Run full typecheck**

Run: `bun run typecheck`

Expected: No type errors

**Step 2: Verify git status**

Run: `git status`

Expected: All changes committed

**Step 3: Run tests**

Run: `bun test`

Expected: All tests pass (or known failures documented)

**Step 4: Create documentation summary**

Update `docs/phase2-ollama-setup.md` with any findings from testing.

**Step 5: Commit any final changes**

```bash
git add -A
git commit -m "docs: update Phase 2 documentation based on testing"
```

**Step 6: Push to remote**

Run: `git push origin feature/phase2-ollama-integration --no-verify`

**Step 7: Create pull request (optional)**

Run:
```bash
gh pr create --title "Phase 2: Ollama Integration - Local Inference" \
  --body "Implements Phase 2 of OPENSACIA: integrating Ollama for local inference with multi-provider support."
```

---

## Validation Checklist

Before marking Phase 2 complete, verify:

- [ ] Default configuration file created with Ollama settings
- [ ] Config directory renamed from opencode to opensacia
- [ ] Config loading merges defaults with user config
- [ ] Ollama health check module created
- [ ] OPENSACIA_OLLAMA_BASE_URL environment variable added
- [ ] Health check runs on startup
- [ ] Documentation created for Ollama setup
- [ ] Unit tests created for health check
- [ ] Manual testing confirms Ollama provider works
- [ ] Tool calling works with local model
- [ ] All typechecks pass
- [ ] Changes pushed to remote

---

## References

- Design Document: `docs/plans/2026-03-05-opensacia-phase2-design.md`
- Phase 1 Implementation: `docs/plans/2026-03-04-opensacia-phase1-implementation.md`
- Ollama Documentation: https://ollama.com/
- @ai-sdk/openai-compatible: https://www.npmjs.com/package/@ai-sdk/openai-compatible
