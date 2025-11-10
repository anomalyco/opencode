# OpenTUI Web

Web-based TUI (Terminal User Interface) for OpenCode - browser-compatible terminal UI for interacting with OpenCode sessions, agents, and workflows.

## Features

- **Session Management** - Create, list, and manage OpenCode sessions
- **Message Viewing** - Display and navigate conversation history with formatted output
- **Prompt Input** - Send messages with file attachment support and character counting
- **File Diffs** - View file changes and diffs for session modifications
- **Todo Tracking** - Display and manage todos associated with sessions
- **Real-time Sync** - Event-driven synchronization with OpenCode backend
- **Responsive UI** - Terminal-like interface that works in modern browsers

## Getting Started

### Installation

```bash
bun install
```

### Development

Start the development server on port 3001 with hot reload:

```bash
bun run dev
```

The application will be available at `http://localhost:3001`.

By default, it connects to the OpenCode API at `http://localhost:4096`. You can configure this in `src/app.tsx`.

### Build

Create a production build:

```bash
bun run build
```

Output is generated in the `dist/` directory.

### Type Checking

Verify TypeScript types without emitting code:

```bash
bun run typecheck
```

### Preview

Preview the production build locally:

```bash
bun run preview
```

## Architecture

### SDK Context (`src/context/sdk.tsx`)

The SDK context provides the OpenCode client and event streaming capabilities:

- **OpencodeClient**: HTTP-based client for API requests
- **Event Emitter**: Real-time event streaming from the OpenCode backend
- **Event Subscription**: Listens to session updates, messages, permissions, and todos

Key exported utilities:

- `useSDK()` - Hook to access the SDK client and event emitter
- `SDKProvider` - Provider component that wraps the application

### Sync Context (`src/context/sync.tsx`)

The sync context manages application state and real-time synchronization:

- **Store Management**: Solid.js reactive store for sessions, messages, parts, todos, and permissions
- **Event Handling**: Listens to SDK events and updates store accordingly
- **Data Loading**: Fetches initial data (sessions, messages, config, etc.)
- **Binary Search**: Efficient sorted insertion and searching of data
- **Path Sanitization**: Removes working directory paths from displayed content

Key utilities:

- `useSync()` - Hook to access state and sync functions
- `SyncProvider` - Provider component for state management
- Session methods for loading and synchronizing specific sessions
- Absolute/sanitize path helpers for consistent display

### Component Structure

```
src/
├── index.tsx              # Entry point
├── app.tsx                # Root App component with providers
├── context/
│   ├── sdk.tsx           # SDK/event streaming context
│   ├── sync.tsx          # State management context
│   └── helper.tsx        # Context utility functions
├── components/
│   ├── session-view.tsx   # Main session list and detail view
│   ├── session-detail.tsx # Single session with messages and input
│   ├── message-list.tsx   # Messages and parts renderer
│   └── prompt-input.tsx   # Message input with file attachment
└── utils/
    └── binary.ts         # Binary search utilities
```

### Key Components

**SessionView**: Main container that displays either a session list or a detailed session view.

**SessionDetail**: Shows a specific session with:

- Message history with formatted output
- File diffs viewer
- Todo list
- Prompt input area

**MessageList**: Renders messages and their parts with support for:

- Text parts with syntax highlighting
- Tool execution parts with input/output/metadata
- File parts with diff visualization
- Proper message ordering and timestamps

**PromptInput**: Input component with:

- Auto-growing textarea
- File attachment support
- Character counter with warnings
- Error display
- Loading state management

## Configuration

### API Endpoint

Configure the OpenCode API URL in `src/app.tsx`:

```typescript
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
})
```

### Development Server Port

The Vite development server runs on port 3001 by default. Configure in `vite.config.ts` if needed:

```typescript
server: {
  port: 3001,
  // ...
}
```

### API Proxy

The development server proxies `/api` requests to the configured backend:

```typescript
proxy: {
  "/api": {
    target: "http://localhost:4096",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ""),
  },
}
```

## File Structure

```
├── dist/                    # Production build output
├── node_modules/           # Dependencies
├── src/
│   ├── index.tsx          # Render entry point
│   ├── app.tsx            # Root component with providers
│   ├── context/           # Context providers and state
│   ├── components/        # UI components
│   └── utils/             # Utility functions
├── index.html             # HTML entry point
├── package.json           # Project metadata and scripts
├── tsconfig.json          # TypeScript configuration
├── vite.config.ts         # Vite build configuration
└── README.md              # This file
```

## Technology Stack

- **SolidJS**: Reactive UI framework
- **Vite**: Build tool and dev server
- **TypeScript**: Type-safe development
- **@opencode-ai/sdk**: OpenCode client SDK
- **@opentui/core & @opentui/solid**: TUI framework
- **Remeda**: Functional utilities
- **Diff**: Diff computation and visualization

## Development Guidelines

### Component Style

- Use function declarations for components
- Use SolidJS primitives (`Show`, `For`, `createSignal`, etc.)
- Prefer inline styles for dynamic styling
- Keep components focused and composable

### State Management

- Use Solid.js store for global state
- Use `createSignal` for local component state
- Prefer computed values over manual state updates
- Use `produce` for immutable store updates

### SDK Integration

- Always import types from `@opencode-ai/sdk/client` to avoid Node.js dependencies
- Use the SDK context for API access
- Handle errors appropriately with user-friendly messages
- Log important events for debugging

## Troubleshooting

### TypeScript Errors

If you see TypeScript errors about missing types:

1. Run `bun run typecheck` to see detailed errors
2. Check that you're importing from `@opencode-ai/sdk/client` not `@opencode-ai/sdk`
3. Ensure all SDK imports are type-only where appropriate

### Build Issues

If the build fails:

1. Run `bun run typecheck` first to catch type errors
2. Check that all dependencies are installed with `bun install`
3. Clear the dist folder and rebuild: `rm -rf dist && bun run build`

### Connection Issues

If the app can't connect to the OpenCode backend:

1. Ensure the OpenCode server is running on `http://localhost:4096`
2. Check the browser console for connection errors
3. Verify network connectivity and CORS settings
4. Check that the API endpoint is configured correctly in `src/app.tsx`

## Contributing

When contributing to opentui-web:

1. **Maintain type safety** - Use TypeScript strictly, avoid `any` when possible
2. **Follow the component structure** - Keep components in the appropriate directories
3. **Test locally** - Run `bun run dev` and test the UI before submitting changes
4. **Check types** - Always run `bun run typecheck` before committing
5. **Document changes** - Update this README if you make significant architectural changes

## License

MIT

## See Also

- [OpenCode](https://github.com/opencode-ai/opencode) - Main OpenCode repository
- [@opencode-ai/sdk](../sdk/js) - JavaScript SDK for OpenCode
- [OpenTUI](https://github.com/opentui/opentui) - TUI framework
