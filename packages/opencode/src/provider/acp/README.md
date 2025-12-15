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

When using ACP backends, tool execution happens on the ACP side, but OpenCode's permission system can still control which tools are allowed.

### How It Works

- OpenCode disables its internal tool system for ACP providers (see `provider.ts`)
- The ACP backend (cursor-agent, goose, etc.) has its own tool implementations
- OpenCode exposes permission callbacks (`requestPermission`, `readTextFile`, `writeTextFile`) via the ACP protocol
- When the ACP backend calls `requestPermission`, OpenCode applies your permission config and returns `allow` or `cancelled`
- Well-behaved ACP backends respect the `cancelled` response and don't execute the denied tool

### Cursor ACP Permissions

**Verified via testing:** Cursor's ACP implementation **does** call the `requestPermission` callback and respects the response.

Example configuration:
```bash
OPENCODE_PERMISSION='{"edit":"deny","bash":"deny"}' opencode run -m cursor-acp/auto "write to file.txt"
```

What happens:
1. Cursor calls `requestPermission` with `kind: "edit"` → OpenCode returns `cancelled`
2. Cursor may try alternative tools (e.g., bash/execute) → OpenCode returns `cancelled` if also denied
3. If all tool paths are denied, the operation fails with "security restrictions"

**Important**: Cursor is smart about fallbacks. If you deny `edit` but allow `bash`, Cursor will use a shell command instead. To fully block file writes, deny both `edit` and `bash`.

### File Operation Callbacks

Cursor's ACP implementation does **not** use the `readTextFile` and `writeTextFile` callbacks. It uses its own internal file tools that go through `requestPermission` instead. This is fine - the permission system still works via `requestPermission`.

### Security Implications

When using ACP backends, be aware that:

- The ACP backend controls which tools it exposes and how it names them
- OpenCode maps tool kinds (`edit`, `execute`, `read`, `fetch`) to permission types
- Trust in the ACP backend is required - it has the same filesystem/network access as the subprocess

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

- **Tool fallbacks**: ACP backends may try alternative tools when one is denied. To fully block file writes, deny both `edit` and `bash`.
- **File callbacks not used by Cursor**: Cursor doesn't use `readTextFile`/`writeTextFile` callbacks, but permissions still work via `requestPermission`.
- Creates new subprocess per request (no connection pooling yet)
- Sessions are stateless (new session per request)
- ACP agent must be installed and available in PATH

## Future Enhancements

- Connection pooling to reuse subprocesses
- Stateful session management across multiple requests
- Advanced tool coordination if conflicts emerge
- Performance monitoring and metrics
- Caching for model capabilities
