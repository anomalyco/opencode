# CLI Component

The Command Line Interface is the primary way users interact with OpenCode. It provides commands for running sessions, managing configuration, and controlling the system.

## Architecture

```
┌─────────────────┐
│   CLI Entry     │ ← packages/opencode/src/index.ts
└─────────────────┘
          │
          ▼
┌─────────────────┐
│  Command Router │ ← yargs-based command parsing
└─────────────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
┌─────────┐ ┌─────────────┐
│ Commands│ │   Server    │
│ (cmd/)  │ │ Management  │
└─────────┘ └─────────────┘
```

## Core Files

### Entry Point

- **`packages/opencode/src/index.ts`** - Main CLI entry point
  - Sets up yargs command router
  - Configures logging and error handling
  - Registers all available commands

### Command Structure

- **`packages/opencode/src/cli/cmd/`** - Individual command implementations
- **`packages/opencode/src/cli/cmd/cmd.ts`** - Command wrapper utilities

## Main Commands

### 1. Run Command (`packages/opencode/src/cli/cmd/run.ts`)

The primary command for running OpenCode sessions.

```bash
opencode run [message..] [options]
```

**Key Features:**

- Session creation and continuation
- File attachment support
- Model and agent selection
- Real-time streaming output
- Session sharing

**Flow:**

```typescript
run() → bootstrap() → Server.listen() → execute() → eventProcessor()
```

### 2. TUI Commands

#### Spawn (`packages/opencode/src/cli/cmd/tui/spawn.ts`)

Starts TUI with dedicated server process.

```bash
opencode spawn [project] [options]
```

**Process:**

1. Start HTTP server
2. Spawn TUI process attached to server
3. Handle cleanup on exit

#### Attach (`packages/opencode/src/cli/cmd/tui/attach.ts`)

Attach TUI to existing server.

```bash
opencode attach <server-url>
```

#### Thread (`packages/opencode/src/cli/cmd/tui/thread.ts`)

Thread-based TUI for single session.

```bash
opencode thread [session-id]
```

### 3. Management Commands

#### Auth (`packages/opencode/src/cli/cmd/auth.ts`)

Authentication management.

```bash
opencode auth [provider]
```

#### Agent (`packages/opencode/src/cli/cmd/agent.ts`)

Agent management and generation.

```bash
opencode agent list
opencode agent generate <description>
```

#### Models (`packages/opencode/src/cli/cmd/models.ts`)

List available models.

```bash
opencode models
```

### 4. Utility Commands

#### Generate (`packages/opencode/src/cli/cmd/generate.ts`)

Generate various configurations.

#### Export/Import (`packages/opencode/src/cli/cmd/export.ts`, `import.ts`)

Session data management.

#### Upgrade (`packages/opencode/src/cli/cmd/upgrade.ts`)

Update OpenCode to latest version.

## Command Architecture

### Command Definition Pattern

```typescript
export const CommandName = cmd({
  command: "command [args..]",
  describe: "Command description",
  builder: (yargs: Argv) => {
    return yargs
      .positional("args", {
        /* ... */
      })
      .option("option", {
        /* ... */
      })
  },
  handler: async (args) => {
    // Command implementation
  },
})
```

### Bootstrap Process

```typescript
// packages/opencode/src/cli/bootstrap.ts
async function bootstrap(directory: string, fn: () => Promise<void>) {
  // 1. Change to project directory
  // 2. Initialize project instance
  // 3. Set up storage
  // 4. Execute function
  // 5. Cleanup on exit
}
```

## Error Handling

### Global Error Handlers

```typescript
// packages/opencode/src/index.ts
process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", { e })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", { e })
})
```

### Command Error Handling

```typescript
// packages/opencode/src/cli/error.ts
export function FormatError(error: any): string | undefined {
  if (error instanceof NamedError) {
    return formatNamedError(error)
  }
  // ... other error types
}
```

## Configuration

### CLI Configuration

- **`packages/opencode/src/config/`** - Configuration management
- **`packages/opencode/src/flag/`** - Feature flags

### Environment Variables

- `OPENCODE_INSTALL_DIR` - Custom installation path
- `XDG_BIN_DIR` - XDG-compliant binary directory
- `LOG_LEVEL` - Logging verbosity

## Output Formatting

### UI Utilities (`packages/opencode/src/cli/ui.ts`)

```typescript
export const UI = {
  println: (...args: any[]) => void,
  error: (message: string) => void,
  markdown: (text: string) => string,
  logo: () => string,
  Style: { /* color constants */ }
}
```

### Progress Indicators

- Tool execution status
- Streaming response display
- Error formatting

## Integration Points

### Server Integration

```typescript
// packages/opencode/src/server/server.ts
const server = Server.listen({ port, hostname })
const sdk = createOpencodeClient({ baseUrl: server.url })
```

### SDK Integration

```typescript
// packages/opencode/sdk/js/
const sdk = createOpencodeClient({ baseUrl })
await sdk.session.prompt({ sessionID, parts })
```

## Binary Distribution

### Binary Wrapper (`packages/opencode/bin/opencode`)

- Platform-specific binary detection
- Fallback to Node.js execution
- Installation path resolution

### Build Process

```typescript
// packages/opencode/script/build.ts
// 1. Compile TypeScript
// 2. Bundle dependencies
// 3. Create platform binaries
// 4. Generate installation scripts
```

## Development Workflow

### Local Development

```bash
# From packages/opencode directory
bun dev                    # Run in development mode
bun test                   # Run tests
bun run build             # Build for distribution
```

### Command Testing

```typescript
// packages/opencode/test/
// Integration tests for each command
// Mock server responses
// CLI output validation
```

## Security Considerations

### Input Validation

- Command argument validation
- File path sanitization
- Permission checks

### Execution Context

- Working directory restrictions
- Environment variable controls
- Process isolation

## Performance Optimizations

### Startup Time

- Lazy loading of components
- Minimal initial imports
- Async initialization

### Memory Usage

- Stream processing for large outputs
- Garbage collection optimization
- Connection pooling

The CLI component serves as the primary interface to OpenCode, providing a comprehensive set of commands for managing AI-powered development sessions.
