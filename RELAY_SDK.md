# Veritly Relay SDK

## Overview
The Relay SDK connects backend agents to browsers through a WebSocket relay.
The browser executes commands (like Univer SDK operations) and returns results.

```
Backend (Agent) → Relay → Browser → executes → Browser → Relay → Backend
```

## Architecture

### Components
1. **Relay Server** (`packages/relay/server.ts`)
   - WebSocket server on port 8080
   - Accepts connections from browsers (role=browser) and agents (role=agent)
   - Forwards agent requests to browser
   - Routes browser responses back to correct agent

2. **Relay SDK** (`packages/opencode/src/relay/sdk.ts`)
   - Agent-side client for connecting to relay
   - Sends requests and awaits responses
   - Handles reconnection and timeouts

3. **SimulatedBrowser** (test helper)
   - Simulates browser side for testing
   - Receives commands from relay
   - Sends back responses

## Usage

### Backend Agent
```typescript
const relay = Relay.create({
  relayUrl: "ws://localhost:8080/relay/ws?role=agent"
})

await relay.connect()

// Send command to browser
const result = await relay.executeUniverCommand("RangeRect.create", {
  startRow: 0,
  endRow: 10,
  startColumn: 0,
  endColumn: 5,
})
```

### Browser (Frontend)
```typescript
const ws = new WebSocket("ws://localhost:8080/relay/ws?role=browser")

ws.onmessage = (event) => {
  const req = JSON.parse(event.data)
  
  // Execute Univer SDK command
  const result = executeUniverCommand(req)
  
  // Send response back
  ws.send(JSON.stringify({
    id: req.id,
    ok: true,
    result
  }))
}
```

## Tests

### Running Relay Tests
```bash
cd packages/opencode
bun test test/integration/relay.test.ts --timeout 60000
```

### Test Coverage
- Health checks
- Agent/browser connection
- Command forwarding
- Multiple concurrent requests
- Error handling
- Univer SDK command flow
- Browser disconnection handling
- Big Pickle message test

## Files Created

### SDK
- `packages/opencode/src/relay/sdk.ts` - Relay SDK for agents

### Test Infrastructure
- `packages/opencode/test/fixture/relay-testcontainer.ts` - Relay container + SimulatedBrowser
- `packages/opencode/test/integration/relay.test.ts` - 12 integration tests

## Key Features

1. **Command Forwarding**: Backend commands reach browser
2. **Response Routing**: Browser responses return to correct backend request
3. **Connection Management**: Handles reconnects and disconnections
4. **Timeout Handling**: Requests timeout if browser doesn't respond
5. **Health Monitoring**: Check relay and browser status

## Testcontainer Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Test Runner                       │
│                                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │         Relay Testcontainer                  │   │
│  │                                              │   │
│  │  ┌──────────────┐      ┌──────────────────┐  │   │
│  │  │ Relay Server │◄────►│ SimulatedBrowser │  │   │
│  │  │   :8080      │  WS  │   (test fake)    │  │   │
│  │  └──────────────┘      └──────────────────┘  │   │
│  │         ▲                                      │   │
│  └─────────┼──────────────────────────────────────┘   │
│            │                                         │
│  ┌─────────┼──────────────────────┐                  │
│  │   RelaySDK (Agent)              │                  │
│  │   - sends requests              │                  │
│  │   - receives responses          │                  │
│  └──────────────────────────────────┘                  │
└─────────────────────────────────────────────────────┘
```

## SimulatedBrowser

For testing, we simulate the browser side:
- Connects to relay as `role=browser`
- Registers handlers for operations (e.g., `univer.execute`)
- Receives requests from relay
- Returns mock responses

This lets us test the full flow without needing a real browser.

## Big Pickle Test

Special test that verifies message flow:
```typescript
browser.on("chat.send", async (params) => {
  return { 
    delivered: true, 
    recipient: "Big Pickle",
    echo: `Big Pickle received: ${params.message}` 
  }
})

const result = await relay.request("chat.send", {
  message: "Hi Big Pickle! This is an integration test!",
})

expect(result.delivered).toBe(true)
```

This validates that:
1. Backend message reaches browser (via relay)
2. Browser processes it
3. Response returns to backend
