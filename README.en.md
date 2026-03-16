# Acompany Secure Code

A secure coding agent from Acompany that enables AI-assisted development without leaking confidential source code.  
The beta release became available on March 13, 2026 as the second product in the Confidential AI Suite.

[![Acompany Secure Code top screen](github/assets/top-secure-code.png)](./github/assets/securecode-demo.mp4)

[Press release](https://prtimes.jp/main/html/rd/p/000000128.000046917.html) | [Contact](https://www.acompany.tech/contact) | [Japanese README](./README.md)

## Overview

Acompany Secure Code sends confidential source code into a Confidential Computing environment and runs LLM inference inside an isolated execution boundary. This allows teams to use AI coding assistance while preventing infrastructure operators, model providers, and other third parties from viewing data during processing.

The goal is to support code generation, review, refactoring, bug fixing, and test generation for organizations that handle sensitive codebases, without forcing them to abandon their existing terminal-centric workflow.

## Key Features

- Code protection: Runs inference on top of a Trusted Execution Environment and protects both source code I/O and LLM processing.
- Workflow fit: Keeps a terminal-first developer experience that can be integrated directly into everyday implementation work.
- Auditability: Records and visualizes AI usage logs so teams can trace who used AI, when, and against which codebase.
- Model options: Supports open-weight LLMs such as GPT-OSS, Qwen3.5, and Qwen3-Coder-Next.

## Screens

### Home Screen

![Acompany Secure Code home screen](github/assets/top-secure-code.png)

### Model Picker

![Acompany Secure Code model picker](github/assets/models-secure-code.png)

## Demo Video

- [securecode-demo.mp4](./github/assets/securecode-demo.mp4)
- The demo shows the flow from the home screen into actual coding assistance.

## Local Development

This repository is a fork that tracks upstream release tags while layering Acompany Secure Code specific changes on top. Some internal package names and command names remain for upstream compatibility, but the public-facing branding is aligned to Secure Code.

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
