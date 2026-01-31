# Cortex Patch Guide

This repo applies a Snowflake Cortex compatibility patch to OpenCode and provides instructions for both:

- Build-from-source (all platforms)
- Patch an existing OpenCode install by replacing the binary

## What the patch changes

- **Snowflake Cortex error handling**: Treats Snowflake “conversation complete” errors as a normal stop condition.
- **Snowflake request compatibility**: When `snowflakeCortex: true` is set, converts `max_tokens` → `max_completion_tokens` for Snowflake’s OpenAI-compatible API.
- **Provider options merge**: Ensures the `snowflakeCortex` flag flows from provider options into the model options used at runtime.

## Build from source (all platforms)

From the repo root:

```bash
bun install
bun dev
```

Run OpenCode against a directory:

```bash
bun dev /path/to/project
```

Build a single-platform binary for your current OS/arch:

```bash
bun ./packages/opencode/script/build.ts --single
```

The binary will be under:

```
packages/opencode/dist/opencode-<os>-<arch>/bin/opencode
```

## Patch an existing OpenCode install

1. **Locate your current `opencode` binary**:

   - macOS/Linux:
     ```bash
     which opencode
     ```
   - Windows (PowerShell):
     ```powershell
     where opencode
     ```

2. **Build the patched binary** (see build step above).

3. **Replace the installed binary**:

   - macOS/Linux:
     ```bash
     cp /path/to/patched/opencode /path/to/installed/opencode
     ```
   - Windows (PowerShell):
     ```powershell
     Copy-Item -Force C:\path\to\patched\opencode.exe C:\path\to\installed\opencode.exe
     ```

### Common install paths

macOS:
- Homebrew (Apple Silicon): `/opt/homebrew/bin/opencode`
- Homebrew (Intel): `/usr/local/bin/opencode`
- Fallback: `~/.opencode/bin/opencode`

Linux:
- System installs: `/usr/local/bin/opencode`
- User installs: `~/.local/bin/opencode` or `~/.opencode/bin/opencode`

Windows:
- Scoop: `C:\Users\<you>\scoop\apps\opencode\current\opencode.exe`
- Chocolatey: `C:\ProgramData\chocolatey\bin\opencode.exe`

## Configure the Snowflake Cortex provider

Add to your config file:

- **User config**: `~/.opencode/opencode.jsonc`
- **Project config**: `./opencode.json`

Example:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "snowflake-cortex": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Snowflake Cortex",
      "options": {
        "baseURL": "https://<account>.snowflakecomputing.com/api/v2/cortex/v1",
        "headers": {
          "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN"
        },
        "snowflakeCortex": true
      },
      "models": {
        "claude-4-sonnet": {
          "name": "Claude 4 Sonnet",
          "tool_call": true,
          "attachment": true,
          "limit": { "context": 200000, "output": 8192 }
        },
        "claude-opus-4-5": {
          "name": "Claude Opus 4.5",
          "tool_call": true,
          "attachment": true,
          "limit": { "context": 200000, "output": 8192 }
        }
      }
    }
  },
  "model": "snowflake-cortex/claude-opus-4-5"
}
```
