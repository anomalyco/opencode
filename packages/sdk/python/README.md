# OpenCode Python SDK

Python SDK for interacting with the OpenCode API.

## Installation

```bash
pip install opencode-sdk
```

## Quick Start

### Sync Usage

```python
from opencode_sdk import create_opencode_client, create_opencode_server

# Start a server
server = create_opencode_server()
print(f"Server started at {server.url}")

# Create a client
client = create_opencode_client(base_url=server.url)

# Create a session
session = client.session.create()
if session.ok:
    # Send a prompt
    response = client.session.prompt(
        session.data["id"],
        parts=[{"type": "text", "text": "Hello, world!"}]
    )
    print(response.data)

# Cleanup
client.close()
server.close()
```

### Async Usage

```python
import asyncio
from opencode_sdk import create_opencode_async

async def main():
    # Create server and client together
    opencode = await create_opencode_async()

    # Create a session
    session = await opencode.client.session.create_async()
    if session.ok:
        # Send a prompt with specific model
        response = await opencode.client.session.prompt_async(
            session.data["id"],
            parts=[{"type": "text", "text": "Hello, world!"}],
            model={"providerID": "openai", "modelID": "gpt-5.2"}
        )
        print(response.data)

    # Cleanup
    await opencode.aclose()

asyncio.run(main())
```

## Authentication

You can add provider API keys directly through the SDK:

```python
from opencode_sdk import create_opencode_client

client = create_opencode_client()

# Sync
client.auth.set("openai", {"type": "api", "key": "sk-..."})

# Async
await client.auth.set_async("openai", {"type": "api", "key": "sk-..."})
```

OpenCode also accepts keys from `/connect` (TUI) or environment variables like `OPENAI_API_KEY`.

## Features

- Full API coverage matching the JavaScript SDK
- Both synchronous and asynchronous API support
- Server-Sent Events (SSE) support for real-time event streaming
- Type hints for all types and methods
- Context manager support for automatic resource cleanup

## API Reference

### Client Creation

```python
from opencode_sdk import create_opencode_client

client = create_opencode_client(
    base_url="http://127.0.0.1:4096",  # Server URL
    timeout=None,                       # Request timeout (None = no timeout)
    headers={"X-Custom": "header"},     # Additional headers
    directory="/path/to/project",       # Default project directory
)
```

### Server Management

```python
from opencode_sdk import (
    create_opencode_server,
    create_opencode_server_async,
    create_opencode_tui,
    ServerOptions,
    TuiOptions,
)

# Sync server
server = create_opencode_server(ServerOptions(
    hostname="127.0.0.1",
    port=4096,
    timeout=5.0,
    config={"logLevel": "INFO"},
))

# Async server
server = await create_opencode_server_async(ServerOptions(...))

# TUI (Terminal UI)
tui = create_opencode_tui(TuiOptions(
    project="/path/to/project",
    model="anthropic/claude-3-opus",
    session="ses_abc123",
    agent="build",
))
```

### Available APIs

All APIs are available as both sync and async methods:

```python
# Sync
client.session.list()

# Async
await client.session.list_async()
```

#### Session API

```python
# List sessions
sessions = client.session.list()

# Create a session
session = client.session.create(title="My Session")

# Get session
session = client.session.get("ses_abc123")

# Send a prompt
response = client.session.prompt(
    "ses_abc123",
    parts=[
        {"type": "text", "text": "Hello!"},
        {"type": "file", "mime": "text/plain", "url": "file:///path/to/file.txt"},
    ],
    agent="build",
    model={"providerID": "anthropic", "modelID": "claude-3-opus"},
)

# Delete session
client.session.delete("ses_abc123")
```

#### Event API

```python
# Subscribe to events (sync)
for event in client.event.subscribe():
    print(event.data)

# Subscribe to events (async)
async for event in client.event.subscribe_async():
    print(event.data)
```

#### Other APIs

- `client.project` - Project management
- `client.pty` - PTY session management
- `client.config` - Configuration
- `client.tool` - Tool management
- `client.instance` - Instance lifecycle
- `client.path` - Path information
- `client.vcs` - Version control
- `client.command` - Custom commands
- `client.provider` - Provider management
- `client.find` - Search functionality
- `client.file` - File operations
- `client.app` - Application info
- `client.mcp` - MCP server management
- `client.lsp` - LSP server status
- `client.formatter` - Formatter status
- `client.tui` - TUI control
- `client.auth` - Authentication
- `client.global_` - Global events

## Type Hints

The SDK includes comprehensive type hints for all types:

```python
from opencode_sdk import (
    Session,
    Message,
    Part,
    TextPart,
    FilePart,
    ToolPart,
    Event,
    Config,
    # ... and many more
)
```

## Context Manager Support

```python
# Sync
with create_opencode_client() as client:
    sessions = client.session.list()

# Async
async with create_opencode_client() as client:
    sessions = await client.session.list_async()
```

## License

MIT
