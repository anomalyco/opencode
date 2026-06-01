# Agent Messaging Project Map

This map tracks the existing opencode surfaces that matter for converting the project from a coding-assistant-first product into a channel-driven agent runtime for Slack, Telegram, WhatsApp, and similar platforms.

## Current Shape

- `packages/opencode` is the core runtime: CLI, HTTP API, session orchestration, tools, agents, permissions, storage, and event bus.
- `packages/sdk/js` is the supported programmatic client boundary. It can start an opencode server and call generated API methods.
- `packages/slack` is already a messaging adapter. It starts an opencode server, maps Slack threads to opencode sessions, forwards user text to `session.prompt`, and posts responses back to Slack.
- `packages/app`, `packages/desktop`, `packages/web`, `sdks/vscode`, and `packages/console/*` are UI, distribution, and hosted-console surfaces. They should not be the first place to add messaging-agent logic

## Core Runtime Files

- `packages/opencode/src/agent/agent.ts` defines primary and subagent configuration, permissions, default agent selection, and agent generation.
- `packages/opencode/src/session/session.ts` owns session lifecycle and metadata.
- `packages/opencode/src/session/prompt.ts` is the prompt execution boundary used by HTTP handlers and SDK callers.
- `packages/opencode/src/session/message-v2.ts` and `packages/opencode/src/session/message.ts` own persisted message shape and retrieval.
- `packages/opencode/src/session/status.ts` exposes active/idle state for sessions.
- `packages/opencode/src/bus/index.ts` provides instance-scoped publish/subscribe and global event emission.
- `packages/opencode/src/server/server.ts` starts the HTTP server.
- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` declares session API routes including create, prompt, async prompt, messages, share, abort, and permissions.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` wires session API routes to services.
- `packages/opencode/src/server/routes/instance/httpapi/groups/event.ts` and `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts` expose server-sent event subscription.

## SDK Boundary

- `packages/sdk/js/src/index.ts` exports `createOpencode`, which starts a local server and returns `{ client, server }`.
- `packages/sdk/js/src/server.ts` starts the `opencode serve` process with config injected through `OPENCODE_CONFIG_CONTENT`.
- `packages/sdk/js/src/client.ts` creates the generated OpenCode client and handles directory routing headers.
- `packages/sdk/js/src/gen/*` is generated. Do not edit it directly; regenerate the JavaScript SDK with `./packages/sdk/js/script/build.ts` after OpenAPI changes.

## Existing Slack Adapter

- `packages/slack/package.json` declares the Slack package as `@opencode-ai/slack` and depends on `@opencode-ai/sdk` plus `@slack/bolt`.
- `packages/slack/src/index.ts` currently:
  - starts a local opencode server with `createOpencode({ port: 0 })`,
  - maintains an in-memory map from Slack channel/thread to opencode session,
  - creates a new opencode session per Slack thread,
  - sends Slack text to `client.session.prompt`,
  - listens to `client.event.subscribe()` for tool updates,
  - replies into the Slack thread.
- `packages/slack/README.md` documents Slack Socket Mode setup.

## Repository Conventions

- Specs live under `specs` at the root or package-local `specs` directories.
- Tests must not run from the repository root. Use package directories such as `packages/opencode`.
- Type checks must use `bun typecheck` from package directories, not direct `tsc`.
- TypeScript style prefers inference, dot notation over unnecessary destructuring, no `any`, no needless helpers, and early returns over `else`.

## External Agent Reference

OpenClaw is a relevant reference project because its GitHub organization describes it as a personal open-source AI assistant, and its primary repository is TypeScript-based with a platform/assistant focus. Treat OpenClaw as an architecture reference and possible integration target, not as code to vendor blindly into this repo.

- Reference: [openclaw GitHub organization](https://github.com/openclaw)
- Candidate comparison areas: channel adapters, skill/plugin registry, persistent agent memory, background jobs, identity model, and permission gates.

## Initial Architectural Conclusion

The safest migration path is not to replace opencode with another agent project. The existing runtime already has sessions, agents, tools, permissions, MCP, events, and an SDK etc. The missing layer is a first-class channel adapter/runtime package that standardizes the Slack pattern and adds providers for Telegram, WhatsApp, and future messaging platforms.
