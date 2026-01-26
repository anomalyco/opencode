# Mobile App - AGENTS.md

## Overview

React Native / Expo mobile client for opencode. Connects to an opencode server instance via HTTP + SSE for real-time updates.

## Architecture

```
packages/mobile/
├── app/                    # Expo Router file-based routing
│   ├── (tabs)/             # Tab navigation (sessions, connections, settings)
│   ├── session/[id].tsx    # Chat screen
│   └── connection/         # Add/edit connection screens
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── markdown/       # Markdown renderer (wraps react-native-marked)
│   │   └── AuthGate.tsx    # Biometric auth gate
│   ├── lib/
│   │   ├── sdk.ts          # HTTP + SSE client for opencode server API
│   │   └── types.ts        # Re-exported types
│   └── stores/             # Zustand state stores
│       ├── sessions.ts     # Session list, messages, parts
│       ├── connections.ts  # Server connections, client lifecycle
│       ├── events.ts       # SSE event stream, status tracking, permissions, questions
│       └── auth.ts         # Biometric auth
```

## Key Patterns

- **SSE for real-time**: The `events.ts` store connects to `/global/event` and dispatches to other stores
- **Fire-and-forget sends**: `sendMessage` posts to the API but doesn't await response; SSE events drive all UI updates
- **Session status**: Derived from `session.status` events (`idle`/`busy`/`retry`) + last part type for status text
- **Markdown**: `react-native-marked` wrapped in our own `Markdown` component with custom `CodeBlock` (copy button). Designed to be swappable/publishable later.

## Style Guide

Follow the root repo AGENTS.md style guide:

- Prefer `const` over `let`
- Avoid `else` statements, use early returns
- Prefer single-word variable names
- Avoid `try/catch` where possible
- Avoid `any` type
- Use Bun APIs where applicable (for scripts, not in RN runtime)

## Running

```bash
cd packages/mobile
bun install
bun start        # Expo dev server
bun run ios      # iOS simulator
bun run android  # Android emulator
```

## Connecting

Run `opencode serve --hostname 0.0.0.0 --port 4096` on your machine, then add a connection in the app with your machine's local IP and port 4096.
