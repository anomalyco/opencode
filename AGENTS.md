## IMPORTANT

- Try to keep things in one function unless composable or reusable
- DO NOT do unnecessary destructuring of variables
- DO NOT use `else` statements unless necessary
- DO NOT use `try`/`catch` if it can be avoided
- AVOID `try`/`catch` where possible
- AVOID `else` statements
- AVOID using `any` type
- AVOID `let` statements
- PREFER single word variable names where possible
- Use as many bun apis as possible like Bun.file()

## Build/Test Commands

- **TypeScript Check**: `bun run typecheck` (packages/opencode)
- **Go Build**: `go build ./...` (packages/tui)
- **Go Test**: `go test ./...` (packages/tui)
- **Dev Server**: `bun dev` (packages/opencode)
- **Push with Skip Checks**: `git push --no-verify` (when TypeScript issues are non-critical)

## EvalOps Integration Architecture

### Bus System Pattern
```typescript
// Define events
const Event = Bus.event("event.name", z.object({ ... }))

// Publish events  
await Bus.publish(Event, { ... })

// Subscribe to events
Bus.subscribe(Event, (event) => { ... })
```

### Message Structure (MessageV2)
```typescript
// Access message properties correctly
msg.info.role          // "user" | "assistant" 
msg.parts[].type       // "text" | "tool" | "reasoning" | etc
msg.parts[].text       // for text parts
```

### Error Handling Patterns
```typescript
// Custom errors with NamedError.create()
const CustomError = NamedError.create("ErrorName", schema)
throw new CustomError({ data })

// Type-safe error handling
error instanceof Error ? error.message : String(error)
```

### Lock System
```typescript
// Use Lock namespace, not constructor
using _ = await Lock.read(key)    // for read operations
using _ = await Lock.write(key)   // for write operations
```

### Theme System (Go)
```go
// Use compat.AdaptiveColor for theme colors
color := t.Primary()              // Returns compat.AdaptiveColor
style := lipgloss.NewStyle().Foreground(color)
```

## Common TypeScript Fixes

1. **Property Access**: Use bracket notation for index signatures: `config["PROPERTY"]`
2. **Unused Parameters**: Prefix with underscore: `_sessionID` 
3. **Bus API**: Use `Bus.publish()` not `Bus.emit()`
4. **Message Props**: Use `msg.info.role` not `msg.role`
5. **Error Types**: Check `instanceof Error` before accessing `.message`

## Debugging

- To test opencode in the `packages/opencode` directory you can run `bun dev`
- EvalOps integration test: `./test-evalops.sh`
- Go TUI with EvalOps theme: `go run ./cmd/opencode`
