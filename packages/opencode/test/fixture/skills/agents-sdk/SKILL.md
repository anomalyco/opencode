---
name: agents-sdk
description: Build AI agents on Cloudflare Workers using the Agents SDK. Load when creating stateful agents, durable workflows, real-time WebSocket apps, scheduled tasks, MCP servers, or chat applications. Covers Agent class, state management, callable RPC, Workflows integration, and React hooks.
---

# Cloudflare Agents SDK

**STOP.** Your knowledge of the Agents SDK may be outdated. Prefer retrieval over pre-training for any Agents SDK task.

## Documentation

Fetch current docs from `https://github.com/cloudflare/agents/tree/main/docs` before implementing.

| Topic | Doc | Use for |
|-------|-----|---------|
| Getting started | `docs/getting-started.md` | First agent, project setup |
| State | `docs/state.md` | `setState`, `validateStateChange`, persistence |
| Routing | `docs/routing.md` | URL patterns, `routeAgentRequest`, `basePath` |
| Callable methods | `docs/callable-methods.md` | `@callable`, RPC, streaming, timeouts |
| Scheduling | `docs/scheduling.md` | `schedule()`, `scheduleEvery()`, cron |
| Workflows | `docs/workflows.md` | `AgentWorkflow`, durable multi-step tasks |
| HTTP/WebSockets | `docs/http-websockets.md` | Lifecycle hooks, hibernation |
| Email | `docs/email.md` | Email routing, secure reply resolver |
| MCP client | `docs/mcp-client.md` | Connecting to MCP servers |
| MCP server | `docs/mcp-servers.md` | Building MCP servers with `McpAgent` |
| Client SDK | `docs/client-sdk.md` | `useAgent`, `useAgentChat`, React hooks |
| Human-in-the-loop | `docs/human-in-the-loop.md` | Approval flows, pausing workflows |
| Resumable streaming | `docs/resumable-streaming.md` | Stream recovery on disconnect |

Cloudflare docs: https://developers.cloudflare.com/agents/

## Capabilities

The Agents SDK provides:

- **Persistent state** - SQLite-backed, auto-synced to clients
- **Callable RPC** - `@callable()` methods invoked over WebSocket
- **Scheduling** - One-time, recurring (`scheduleEvery`), and cron tasks
- **Workflows** - Durable multi-step background processing via `AgentWorkflow`
- **MCP integration** - Connect to MCP servers or build your own with `McpAgent`
- **Email handling** - Receive and reply to emails with secure routing
- **Streaming chat** - `AIChatAgent` with resumable streams
- **React hooks** - `useAgent`, `useAgentChat` for client apps

## FIRST: Verify Installation

```bash
npm ls agents  # Should show agents package
```

If not installed:
```bash
npm install agents
```

## Wrangler Configuration

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "MyAgent", "class_name": "MyAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MyAgent"] }]
}
```

## Agent Class

```typescript
import { Agent, routeAgentRequest, callable } from "agents";

type State = { count: number };

export class Counter extends Agent<Env, State> {
  initialState = { count: 0 };

  // Validation hook - runs before state persists (sync, throwing rejects the update)
  validateStateChange(nextState: State, source: Connection | "server") {
    if (nextState.count < 0) throw new Error("Count cannot be negative");
  }

  // Notification hook - runs after state persists (async, non-blocking)
  onStateUpdate(state: State, source: Connection | "server") {
    console.log("State updated:", state);
  }

  @callable()
  increment() {
    this.setState({ count: this.state.count + 1 });
    return this.state.count;
  }
}

export default {
  fetch: (req, env) => routeAgentRequest(req, env) ?? new Response("Not found", { status: 404 })
};
```

## Routing

Requests route to `/agents/{agent-name}/{instance-name}`:

| Class | URL |
|-------|-----|
| `Counter` | `/agents/counter/user-123` |
| `ChatRoom` | `/agents/chat-room/lobby` |

Client: `useAgent({ agent: "Counter", name: "user-123" })`

## Core APIs

| Task | API |
|------|-----|
| Read state | `this.state.count` |
| Write state | `this.setState({ count: 1 })` |
| SQL query | `` this.sql`SELECT * FROM users WHERE id = ${id}` `` |
| Schedule (delay) | `await this.schedule(60, "task", payload)` |
| Schedule (cron) | `await this.schedule("0 * * * *", "task", payload)` |
| Schedule (interval) | `await this.scheduleEvery(30, "poll")` |
| RPC method | `@callable() myMethod() { ... }` |
| Streaming RPC | `@callable({ streaming: true }) stream(res) { ... }` |
| Start workflow | `await this.runWorkflow("ProcessingWorkflow", params)` |

## React Client

```tsx
import { useAgent } from "agents/react";

function App() {
  const [state, setLocalState] = useState({ count: 0 });

  const agent = useAgent({
    agent: "Counter",
    name: "my-instance",
    onStateUpdate: (newState) => setLocalState(newState),
    onIdentity: (name, agentType) => console.log(`Connected to ${name}`)
  });

  return (
    <button onClick={() => agent.setState({ count: state.count + 1 })}>
      Count: {state.count}
    </button>
  );
}
```

## References

- **[references/workflows.md](references/workflows.md)** - Durable Workflows integration
- **[references/callable.md](references/callable.md)** - RPC methods, streaming, timeouts
- **[references/state-scheduling.md](references/state-scheduling.md)** - State persistence, scheduling
- **[references/streaming-chat.md](references/streaming-chat.md)** - AIChatAgent, resumable streams
- **[references/mcp.md](references/mcp.md)** - MCP server integration
- **[references/email.md](references/email.md)** - Email routing and handling
- **[references/codemode.md](references/codemode.md)** - Code Mode (experimental)
