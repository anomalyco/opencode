# Acompany SecreCode

A secure coding agent from Acompany that enables AI-assisted development without leaking confidential source code.  
The beta release became available on March 13, 2026 as the second product in the Confidential AI Suite.

[![Acompany SecreCode top screen](https://img.youtube.com/vi/QCwp4IbuP2I/maxresdefault.jpg)](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)

[Press release](https://prtimes.jp/main/html/rd/p/000000128.000046917.html) | [Contact](https://www.acompany.tech/contact) | [Japanese README](./README.md)

## Overview

Acompany SecreCode sends confidential source code into a Confidential Computing environment and runs LLM inference inside an isolated execution boundary. This allows teams to use AI coding assistance while preventing infrastructure operators, model providers, and other third parties from viewing data during processing.

The goal is to support code generation, review, refactoring, bug fixing, and test generation for organizations that handle sensitive codebases, without forcing them to abandon their existing terminal-centric workflow.

## Key Features

- Code protection: Runs inference on top of a Trusted Execution Environment and protects both source code I/O and LLM processing.
- Workflow fit: Keeps a terminal-first developer experience that can be integrated directly into everyday implementation work.
- Auditability: Records and visualizes AI usage logs so teams can trace who used AI, when, and against which codebase.
- Model options: Supports open-weight LLMs such as GPT-OSS, Qwen3.5, and Qwen3-Coder-Next.

## Screens

### Home Screen

![Acompany SecreCode home screen](github/assets/top-secure-code.png)

### Model Picker

![Acompany SecreCode model picker](github/assets/models-secure-code.png)

## Demo Video

[![Acompany SecreCode demo video](https://img.youtube.com/vi/QCwp4IbuP2I/maxresdefault.jpg)](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)

- [Watch on YouTube](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)
- The demo shows the flow from the home screen into actual coding assistance.

## Install

The latest CLI binaries are published on [GitHub Releases](https://github.com/acompany-develop/securecode/releases).

- macOS Apple Silicon: `SecreCode-darwin-arm64.zip`
- macOS Intel: `SecreCode-darwin-x64.zip`
- Linux x86_64: `SecreCode-linux-x64.tar.gz`
- Linux ARM64: `SecreCode-linux-arm64.tar.gz`
- Windows x86_64: `SecreCode-windows-x64.zip`
- Windows ARM64: `SecreCode-windows-arm64.zip`

Notes:

- `*-baseline` targets older x86_64 CPUs without AVX2.
- `*-musl` targets Alpine Linux.

macOS / Linux:

```bash
# Example: Linux x86_64
tar -xzf SecreCode-linux-x64.tar.gz
chmod +x SecreCode
mkdir -p ~/.local/bin
mv SecreCode ~/.local/bin/SecreCode
export PATH="$HOME/.local/bin:$PATH"
```

```bash
# Example: macOS Apple Silicon
unzip SecreCode-darwin-arm64.zip
chmod +x SecreCode
mkdir -p ~/.local/bin
mv SecreCode ~/.local/bin/SecreCode
export PATH="$HOME/.local/bin:$PATH"
```

Windows:

```powershell
Expand-Archive .\SecreCode-windows-x64.zip -DestinationPath .
$env:Path += ";$PWD"
.\SecreCode.exe run "hello"
```

Prerequisites:

- `git` should be available in your PATH.
- `ripgrep` is strongly recommended for search-heavy workflows.

## Configure Models

The config file remains `opencode.json` for upstream compatibility. You can place it in the project root or in `~/.config/opencode/opencode.json`.

1. Export the provider API key.

```bash
export OPENAI_API_KEY="your-api-key"
```

2. Inspect available model IDs.

```bash
SecreCode models openai --refresh
```

3. Pin the default model in `opencode.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}"
      }
    }
  },
  "model": "openai/gpt-5.2",
  "small_model": "openai/gpt-5.2-mini"
}
```

If you use an OpenAI-compatible gateway, add `baseURL`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}",
        "baseURL": "https://your-gateway.example.com/v1"
      }
    }
  },
  "model": "openai/gpt-5.2"
}
```

## Usage

Single prompt:

```bash
SecreCode run "Summarize the current repository structure"
```

Override the model for one run:

```bash
SecreCode run -m openai/gpt-5.2 "Review auth.ts for security issues"
```

Attach files:

```bash
SecreCode run -f README.md -f src/auth.ts "Explain the auth flow and list risks"
```

Check configured credentials:

```bash
SecreCode providers list
```

## Local Development

This repository is a fork that tracks upstream release tags while layering Acompany SecreCode specific changes on top. Some internal package names and compatibility settings still keep the old names, but the public-facing branding is aligned to SecreCode.

```bash
bun install
bun run guard:upstream
./run-securecode.sh /path/to/your/repository
```

To inspect the UI separately:

```bash
bun run dev:web
bun run dev:desktop
```

See [specs/upstream-sync.md](./specs/upstream-sync.md) for the upstream sync policy.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development flow and review expectations.

## Links

- Product site: https://www.acompany.tech/
- Contact: https://www.acompany.tech/contact
- Press release: https://prtimes.jp/main/html/rd/p/000000128.000046917.html
