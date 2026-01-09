# ACP Provider for OpenCode

This directory implements support for ACP (Agent Client Protocol) backends as LLM providers in OpenCode.

## Overview

The ACP provider allows OpenCode to use ACP-compatible agents (like `cursor-agent`, `goose`, `gemini-cli`) as language model backends by acting as an ACP client.

## Architecture

```
User Request
    ↓
OpenCode (Vercel AI SDK)
    ↓
ACPLanguageModel (implements LanguageModelV2)
    ↓
ACPClient (subprocess management)
    ↓
Subprocess (cursor-agent acp / goose acp / etc.)
    ↓
Backend LLM
```

## Configuration

Add ACP providers to your `opencode.jsonc`:

```jsonc
{
  "provider": {
    "my-acp-provider": {
      "name": "My ACP Provider",
      "options": {
        "command": "cursor-agent", // or "goose", "gemini-cli", etc.
        "args": ["acp"],
      },
      "models": {
        "auto": {
          "id": "auto",
          "name": "Auto Model",
        },
      },
    },
  },
}
```

### Configuration Fields

- **`options.command`** (required): The command to spawn (e.g., `"cursor-agent"`, `"goose"`)
- **`options.args`** (required): Arguments to pass to the command (e.g., `["acp"]`)
- **`models`**: Map of model IDs to model configurations
  - **`id`**: The model ID to pass to the ACP agent
  - **`name`**: Display name for the model
  - **`limit.output`**: Optional max output tokens limit

## Examples

### Goose via ACP

```jsonc
{
  "provider": {
    "goose-acp": {
      "name": "Goose via ACP",
      "options": {
        "command": "goose",
        "args": ["acp"],
      },
      "models": {
        "default": {
          "id": "gpt-4",
          "name": "GPT-4 via Goose",
        },
      },
    },
  },
}
```

### Cursor Agent via ACP

```jsonc
{
  "provider": {
    "cursor-acp": {
      "name": "Cursor via ACP",
      "options": {
        "command": "cursor-agent",
        "args": ["acp"],
      },
      "models": {
        "auto": { "id": "auto", "name": "Cursor Auto" },
        "gpt-5": { "id": "gpt-5", "name": "GPT-5" },
        "opus-4.1": { "id": "opus-4.1", "name": "Claude Opus 4.1" },
      },
    },
  },
}
```

## Tool Execution and Permissions

> **Important Security Notice**: When using ACP as a backend provider (OpenCode → ACP), OpenCode's permission system **cannot enforce** tool execution restrictions. Tool execution is handled entirely by the ACP backend, which has direct filesystem and network access.

### How It Works

- OpenCode disables its internal tool system for ACP providers (see `provider.ts`)
- The ACP backend (cursor-agent, goose, etc.) has its own tool implementations that execute directly
- OpenCode exposes permission callbacks (`requestPermission`, `readTextFile`, `writeTextFile`) via the ACP protocol
- **However**, whether the ACP backend calls these callbacks and respects the responses is entirely up to the backend implementation
- OpenCode has no way to prevent tool execution if the ACP backend chooses to ignore permission responses

### Security Implications

**When using ACP backends, you are trusting the ACP backend completely:**

- The ACP backend has direct access to your filesystem, network, and shell
- OpenCode cannot intercept or block tool execution - it happens inside the ACP subprocess
- Permission callbacks are advisory only - the backend may or may not respect them
- The ACP backend controls which tools it exposes and how it names them

**This is fundamentally different from using OpenCode with direct LLM providers**, where OpenCode controls tool execution and can enforce permissions.

### Cursor ACP Behavior

Based on testing, Cursor's ACP implementation **does** call the `requestPermission` callback and appears to respect the response. However, this is Cursor's implementation choice, not an enforced guarantee.

Example:
```bash
OPENCODE_PERMISSION='{"edit":"deny","bash":"deny"}' opencode run -m cursor-acp/auto "write to file.txt"
```

Observed behavior:
1. Cursor calls `requestPermission` with `kind: "edit"` → OpenCode returns `cancelled`
2. Cursor may try alternative tools (e.g., bash/execute) → OpenCode returns `cancelled` if also denied
3. If all tool paths are denied, Cursor reports "security restrictions"

**Note**: Cursor is smart about fallbacks. If you deny `edit` but allow `bash`, Cursor may use a shell command instead.

### File Operation Callbacks

Cursor's ACP implementation does **not** use the `readTextFile` and `writeTextFile` callbacks. It uses its own internal file tools instead.

## Implementation

### Files

- **`client.ts`**: ACPClient for subprocess management and JSON-RPC communication
- **`model.ts`**: ACPLanguageModel implementing LanguageModelV2 interface
- **`converters.ts`**: Message format conversion between Vercel AI SDK and ACP
- **`factory.ts`**: Provider factory for creating ACP models from config
- **`types.ts`**: TypeScript type definitions
- **`index.ts`**: Public API exports

### Key Features

- **Subprocess Management**: Spawns and manages ACP agent subprocesses using `Bun.spawn()`
- **Stateless Sessions**: Creates new ACP session per request for simplicity
- **Streaming Support**: Full streaming support via `doStream()`
- **Message Conversion**: Converts between Vercel AI SDK and ACP message formats
- **Error Handling**: Proper cleanup and error handling for subprocess lifecycle

## Usage

Once configured, use ACP providers like any other OpenCode provider:

```bash
# Use with the provider/model syntax
opencode chat --model goose-acp/default

# Or set as default in your config
{
  "model": "cursor-acp/gpt-5"
}
```

## Limitations

- **Permissions are not enforceable**: OpenCode cannot enforce permissions when using ACP backends. Tool execution happens inside the ACP subprocess, and OpenCode can only request permission - the backend decides whether to comply.
- **Tool fallbacks**: ACP backends may try alternative tools when one is denied.
- **File callbacks not used by Cursor**: Cursor doesn't use `readTextFile`/`writeTextFile` callbacks.
- Creates new subprocess per request (no connection pooling yet)
- Sessions are stateless (new session per request)
- ACP agent must be installed and available in PATH
