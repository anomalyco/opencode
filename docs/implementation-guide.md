# OpenCode Implementation Guide

Welcome to the comprehensive implementation guide for OpenCode. This documentation provides a deep understanding of the system architecture, components, and how data flows through the AI-powered development tool.

## 🚀 Quick Start

### For New Contributors

1. **Read Architecture Overview** - Understand the big picture
2. **Follow Data Flow** - Learn how components interact
3. **Explore Components** - Dive into specific areas
4. **Check Configuration** - Understand customization options
5. **Review Deployment** - See how the system runs

### For Users

1. **Installation Guide** - Get OpenCode running
2. **CLI Reference** - Learn available commands
3. **Agent System** - Understand AI personalities
4. **Tool Usage** - Master available capabilities
5. **Configuration** - Customize your setup

## 📚 Documentation Structure

### Core Architecture

- **[Architecture Overview](./architecture.md)** - High-level system design and component relationships
- **[Data Flow](./data-flow.md)** - How data moves through the system
- **[Configuration](./configuration.md)** - Configuration system and options
- **[Deployment](./deployment.md)** - Infrastructure and deployment guide

### Component Documentation

- **[CLI](./components/cli.md)** - Command-line interface and commands
- **[Server](./components/server.md)** - Core HTTP API and business logic
- **[Session](./components/session.md)** - Conversation management and persistence
- **[Agent](./components/agent.md)** - AI behavior and permissions
- **[Tools](./components/tools.md)** - Extensible tool system
- **[TUI](./components/tui.md)** - Terminal User Interface
- **[Web](./components/web.md)** - Web-based documentation and sharing
- **[Console](./components/console.md)** - Enterprise management interface

### Development

- **[Extending](./extending.md)** - Plugin development and customization

## 🏗️ System Architecture

OpenCode follows a **client-server architecture** with clear separation of concerns:

```
┌─────────────────┐    HTTP/WebSocket   ┌─────────────────┐
│   Clients       │ ◄──────────────────►│   Server API    │
│ (CLI/TUI/Web)   │                     │   (Hono)        │
└─────────────────┘                     └─────────────────┘
                                             │
                                ┌────────────┴────────────┐
                                │                         │
                                ▼                         ▼
                      ┌─────────────────┐    ┌─────────────────┐
                      │   Session       │    │   AI Providers  │
                      │   Management    │    │                 │
                      └─────────────────┘    └─────────────────┘
```

### Key Components

1. **Server** - Central HTTP API handling all operations
2. **Session** - Conversation management and persistence
3. **Agent** - AI behavior definition and permissions
4. **Tools** - Extensible capability system
5. **Clients** - Multiple interfaces (CLI, TUI, Web)

## 🔄 Data Flow Patterns

### 1. User Interaction Flow

```
User Input → Client Interface → HTTP Request → Server → Session → AI Provider → Tool Execution → Response → Client
```

### 2. Real-time Communication

```
AI Response → Event Bus → WebSocket → All Connected Clients → UI Updates
```

### 3. Tool Execution Flow

```
AI Request → Tool Registry → Permission Check → Tool Execution → Result → AI Provider
```

## 🛠️ Core Technologies

### Backend

- **Runtime**: Bun (JavaScript/TypeScript)
- **Framework**: Hono.js for HTTP server
- **AI Integration**: Vercel AI SDK
- **Storage**: File system + Cloud providers
- **Real-time**: Server-Sent Events + WebSocket

### Frontend

- **TUI**: SolidJS + OpenTUI (terminal-native)
- **Web**: Astro + SolidJS (browser-based)
- **Console**: SolidJS + Kobalte (enterprise)

### Infrastructure

- **Deployment**: SST (Serverless Stack)
- **Platform**: Cloudflare Workers
- **Database**: Cloudflare D1/SQLite
- **Storage**: Cloudflare R2

## 🔧 Development Workflow

### Setting Up Development Environment

```bash
# Clone repository
git clone https://github.com/sst/opencode
cd opencode

# Install dependencies
bun install

# Start development server
cd packages/opencode
bun dev

# Run tests
bun test

# Type checking
bun run typecheck
```

### Project Structure

```
packages/
├── opencode/          # Core CLI and server
├── console/           # Management console
├── web/              # Documentation site
├── ui/               # Shared UI components
├── util/             # Utility functions
├── sdk/              # Client SDKs
└── plugin/           # Plugin system
```

### Building Components

```bash
# Build all packages
bun run build

# Build specific package
cd packages/opencode
bun run build

# Build for production
bun run build:production
```

## 🔍 Understanding the Codebase

### Key Entry Points

1. **CLI Entry**: `packages/opencode/src/index.ts`
   - Command router setup
   - Global error handling
   - Middleware configuration

2. **Server Entry**: `packages/opencode/src/server/server.ts`
   - HTTP route definitions
   - WebSocket handling
   - API documentation

3. **TUI Entry**: `packages/opencode/src/cli/cmd/tui/app.tsx`
   - SolidJS application setup
   - Route configuration
   - Theme management

### Important Patterns

1. **Tool Definition**: `packages/opencode/src/tool/tool.ts`

   ```typescript
   export const ToolName = define("tool-id", {
     description: "Tool description",
     parameters: z.object({
       /* schema */
     }),
     execute: async (args, ctx) => {
       // Implementation
       return { title: "...", output: "..." }
     },
   })
   ```

2. **Agent Configuration**: `packages/opencode/src/agent/agent.ts`

   ```typescript
   const agentInfo = {
     name: "agent-name",
     permission: {
       /* permissions */
     },
     tools: {
       /* tool access */
     },
     prompt: "System prompt...",
   }
   ```

3. **Session Management**: `packages/opencode/src/session/index.ts`
   ```typescript
   const session = await Session.create({ title: "Session Title" })
   const message = await SessionPrompt.prompt({
     sessionID: session.id,
     parts: [{ type: "text", text: "Hello" }],
   })
   ```

## 🎯 Common Tasks

### Adding a New Tool

1. **Create Tool Definition**

   ```typescript
   // packages/opencode/src/tool/my-tool.ts
   export const MyTool = define("my-tool", {
     description: "A custom tool for specific functionality",
     parameters: z.object({
       input: z.string().describe("Input parameter for tool"),
       option: z.enum(["option1", "option2"]).optional().describe("Optional parameter"),
     }),
     execute: async (args, ctx) => {
       // Tool implementation with validation and error handling
       const result = await performMyOperation(args)
       return {
         title: "My Tool Result",
         metadata: {
           /* ... */
         },
         output: result,
       }
     },
   })
   ```

2. **Register Tool**

   ```typescript
   // packages/opencode/src/tool/registry.ts
   import { MyTool } from "./my-tool"

   // Auto-registration through module discovery
   const allTools = [...existingTools, MyTool]
   ```

3. **Add Tests**

   ```typescript
   // packages/opencode/test/tool/my-tool.test.ts
   import { describe, it, expect } from "bun:test"
   import { MyTool } from "../../src/tool/my-tool"

   describe("MyTool", () => {
     it("should validate parameters correctly", async () => {
       const tool = await MyTool.init()
       expect(
         tool.parameters.parse({
           input: "test",
           option: "option1",
         }),
       ).resolves.toBeDefined()

       expect(
         tool.parameters.parse({
           input: 123, // Should fail type validation
           option: "invalid",
         }),
       ).rejects.toThrow()
     })

     it("should execute successfully", async () => {
       const tool = await MyTool.init()
       const result = await tool.execute(
         {
           input: "test",
           option: "option1",
         },
         {
           sessionID: "test-session",
           messageID: "test-message",
           agent: "test-agent",
           abort: new AbortController().signal,
           metadata: async () => {},
         },
       )

       expect(result.title).toBe("My Tool Result")
       expect(result.output).toContain("Processed: test")
     })
   })
   ```

### Adding a New Agent

1. **Define Agent Configuration**

   ```json
   // .opencode/config.json or user config
   {
     "agent": {
       "my-agent": {
         "name": "my-agent",
         "description": "Specialized agent for specific domain",
         "temperature": 0.1,
         "permission": {
           "edit": "ask",
           "bash": {
             "safe-commands": "allow",
             "*": "ask"
           }
         },
         "tools": {
           "my-tool": true,
           "read": true
         }
       }
     }
   }
   }
   ```

2. **Test Agent Behavior**
   ```typescript
   // Test agent with various scenarios
   const agent = await Agent.get("my-agent")
   expect(agent.name).toBe("my-agent")
   expect(agent.permission.edit).toBe("ask")
   ```

### Adding a New CLI Command

1. **Command Structure**
   ```typescript
   // packages/opencode/src/cli/cmd/my-cmd.ts
   export const MyCommand = cmd({
     command: "my-cmd [args..]",
     describe: "Custom command description",
     builder: (yargs) => {
       return yargs
         .positional("args", {
           describe: "Arguments for my command",
           type: "string",
           array: true,
         })
         .option("option", {
           describe: "Command option",
           type: "boolean",
         }),
     },
     handler: async (args) => {
       // Command implementation
       console.log("Executing my command with:", args)
       // ... handler logic
     },
   })
   ```

### Development Workflow

### Unit Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test packages/opencode/test/tool.test.ts

# Run tests in watch mode
bun test --watch

# Test CLI commands
bun test packages/opencode/test/cli/

# Test API endpoints
bun test packages/opencode/test/server/

# Test TUI interactions
bun test packages/opencode/test/tui/
```

### Integration Tests

```bash
# Test tool execution
bun test packages/opencode/test/integration/

# Test agent behavior
bun test packages/opencode/test/agent/

# Test configuration loading
bun test packages/opencode/test/config/
```

### Performance Optimizations

### Server-side

- **Streaming responses**: Real-time feedback to users
- **Lazy loading**: Load components on demand
- **Caching**: Cache frequently accessed data
- **Connection pooling**: Reuse AI provider connections

### Client-side

- **Virtual scrolling**: Handle large message lists
- **Code splitting**: Load UI components as needed
- **Memory management**: Clean up unused resources

## 🔍 Contributing Guidelines

### Code Style

- Follow existing patterns in codebase
- Use TypeScript for type safety
- Keep functions small and focused
- Add proper error handling

### Documentation

- Update relevant documentation
- Add examples for new features
- Include API documentation for changes

### Testing

- Add tests for new functionality
- Ensure existing tests still pass
- Test edge cases and error conditions
- Add integration tests where appropriate

## 📞 Getting Help

### Resources

- **GitHub Issues**: Report bugs and request features
- **Discord Community**: Get help from community
- **Documentation**: Comprehensive guides and API reference
- **Examples**: Sample configurations and workflows

### Troubleshooting

#### Common Issues

1. **Build failures**: Check dependencies and TypeScript version
2. **Tool execution**: Verify permissions and configuration
3. **AI provider**: Check API keys and network connectivity
4. **Performance**: Monitor resource usage and optimize

#### Debug Mode

```bash
# Enable debug logging
opencode --log-level DEBUG

# Run with verbose output
opencode --verbose

# Start TUI in debug mode
DEBUG=tui opencode attach
```

### Integration Tests

```bash
# Test CLI commands
bun test packages/opencode/test/cli/

# Test API endpoints
bun test packages/opencode/test/server/

# Test tool execution
bun test packages/opencode/test/tool/
```

### E2E Tests

```bash
# Test full workflows
bun test packages/opencode/test/e2e/

# Test TUI interactions
bun test packages/opencode/test/tui/
```

## 🚀 Deployment

### Local Development

```bash
# Start development server
sst dev

# Test specific service
sst dev --filter api
```

### Production Deployment

```bash
# Deploy to staging
sst deploy --stage staging

# Deploy to production
sst deploy --stage production
```

### Environment Configuration

- **Development**: Local debugging enabled
- **Staging**: Production-like environment
- **Production**: Optimized and monitored

## 🤝 Contributing Guidelines

### Code Style

- Follow existing patterns in codebase
- Use TypeScript for type safety
- Keep functions small and focused
- Add proper error handling

### Documentation

- Update relevant documentation
- Add examples for new features
- Include API documentation for changes
- Update configuration schema if needed

### Testing

- Add tests for new functionality
- Ensure existing tests still pass
- Test edge cases and error conditions
- Add integration tests where appropriate

## 📞 Getting Help

### Resources

- **GitHub Issues**: Report bugs and request features
- **Discord Community**: Get help from community
- **Documentation**: Comprehensive guides and API reference
- **Examples**: Sample configurations and workflows

### Troubleshooting

#### Common Issues

1. **Build failures**: Check dependencies and TypeScript version
2. **Tool execution**: Verify permissions and configuration
3. **AI provider**: Check API keys and network connectivity
4. **Performance**: Monitor resource usage and optimize

#### Debug Mode

```bash
# Enable debug logging
opencode --log-level DEBUG

# Run with verbose output
opencode --verbose

# Start TUI in debug mode
DEBUG=tui opencode attach
```

---

This implementation guide provides everything needed to understand, extend, and contribute to OpenCode. Whether you're adding new tools, customizing agents, or integrating with external systems, this documentation will help you navigate the codebase effectively.

For specific questions or issues, refer to the individual component documentation or reach out to the community. Happy coding! 🚀
