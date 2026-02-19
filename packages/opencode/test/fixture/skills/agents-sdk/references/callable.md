# Callable Methods

Fetch `docs/callable-methods.md` from `https://github.com/cloudflare/agents/tree/main/docs` for complete documentation.

## Overview

`@callable()` exposes agent methods to clients via WebSocket RPC.

```typescript
import { Agent, callable } from "agents";

export class MyAgent extends Agent<Env, State> {
  @callable()
  async greet(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }

  @callable()
  async processData(data: unknown): Promise<Result> {
    // Long-running work
    return result;
  }
}
```

## Client Usage

```typescript
// Basic call
const greeting = await agent.call("greet", ["World"]);

// With timeout
const result = await agent.call("processData", [data], {
  timeout: 5000  // 5 second timeout
});
```

## Streaming Responses

```typescript
import { Agent, callable, StreamingResponse } from "agents";

export class MyAgent extends Agent<Env, State> {
  @callable({ streaming: true })
  async streamResults(stream: StreamingResponse, query: string) {
    for await (const item of fetchResults(query)) {
      stream.send(JSON.stringify(item));
    }
    stream.close();
  }

  @callable({ streaming: true })
  async streamWithError(stream: StreamingResponse) {
    try {
      // ... work
    } catch (error) {
      stream.error(error.message);  // Signal error to client
      return;
    }
    stream.close();
  }
}
```

Client with streaming:

```typescript
await agent.call("streamResults", ["search term"], {
  stream: {
    onChunk: (data) => console.log("Chunk:", data),
    onDone: () => console.log("Complete"),
    onError: (error) => console.error("Error:", error)
  }
});
```

## Introspection

```typescript
// Get list of callable methods on an agent
const methods = await agent.call("getCallableMethods", []);
// Returns: ["greet", "processData", "streamResults", ...]
```

## When to Use

| Scenario | Use |
|----------|-----|
| Browser/mobile calling agent | `@callable()` |
| External service calling agent | `@callable()` |
| Worker calling agent (same codebase) | DO RPC directly |
| Agent calling another agent | `getAgentByName()` + DO RPC |
