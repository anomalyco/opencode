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

### Advanced: Using Config

You can pass a `Config` dict when creating the server to customize behavior.
`Config` is a TypedDict defined in `opencode_sdk.types`.

```python
import asyncio
from opencode_sdk import create_opencode_async
from opencode_sdk.types import Config

async def main():
    config: Config = {
        # Set default model (format: "provider/model")
        "model": "openai/gpt-5.1",

        # Configure logging
        "logLevel": "INFO",

        # Enable/disable specific tools (all lowercase)
        "tools": {
            "bash": True,
            "read": True,
            "write": True,
            "edit": True,
            "glob": True,
            "grep": True,
            "list": True,
            "webfetch": True,
            "todowrite": True,
            "todoread": True,
            "question": True,
            "skill": True,
            "patch": True,
        },

        # Add custom commands (slash commands)
        "command": {
            "review": {
                "description": "Review the code and suggest improvements",
                "template": "Review the following code and suggest improvements:\n$ARGUMENTS",
                "agent": "default",
            },
            "test": {
                "description": "Generate tests for the code",
                "template": "Generate comprehensive tests for:\n$ARGUMENTS",
                "model": "openai/gpt-5.1",
            },
        },

        # Configure custom agents
        "agent": {
            "architect": {
                "description": "Senior software architect for system design",
                "model": "openai/gpt-5.1",
                "temperature": 0.7,
                "prompt": "You are a senior software architect. Focus on scalability, maintainability, and best practices.",
                "tools": {
                    "read": True,
                    "glob": True,
                    "grep": True,
                    "write": False,  # Read-only agent
                },
            },
            "reviewer": {
                "description": "Code reviewer focused on quality",
                "model": "openai/gpt-5.1",
                "prompt": "You are a code reviewer. Focus on bugs, security issues, and code quality.",
                "maxSteps": 10,
            },
        },

        # Add MCP servers
        "mcp": {
            # Local MCP server - shadcn UI components
            "shadcn": {
                "type": "local",
                "command": ["npx", "shadcn@latest", "mcp"],
                "enabled": True,
            },
            # Local MCP server - Mermaid diagram generator
            "mcp-mermaid": {
                "type": "local",
                "command": ["npx", "-y", "mcp-mermaid"],
                "enabled": True,
            },
            # Remote MCP server - OpenAI Developer Docs
            "openaiDeveloperDocs": {
                "type": "remote",
                "url": "https://developers.openai.com/mcp",
                "enabled": True,
            },
            # Remote MCP server with OAuth - Sentry
            "sentry": {
                "type": "remote",
                "url": "https://mcp.sentry.dev/mcp",
                "oauth": {},  # Auto OAuth
            },
            # Remote MCP server - Context7 (docs search)
            "context7": {
                "type": "remote",
                "url": "https://mcp.context7.com/mcp",
            },
        },

        # Add plugins
        "plugin": [],

        # Custom instructions
        "instructions": [
            "Always use TypeScript for new files",
            "Follow the existing code style",
            "Write comprehensive tests",
        ],
    }

    opencode = await create_opencode_async(config=config)

    client = opencode.client

    # Use custom agent
    session = await client.session.create_async(title="Architecture Review")
    print(session)
    if session.ok:
        response = await client.session.prompt_async(
            session.data["id"],
            parts=[{"type": "text", "text": "Hello world!"}],
        )
        print(response.data)

asyncio.run(main())
```

### Config Options Reference

| Option | Type | Description |
|--------|------|-------------|
| `model` | `str` | Default model (e.g., `"anthropic/claude-sonnet-4"`) |
| `small_model` | `str` | Model for lightweight tasks |
| `tools` | `dict[str, bool]` | Enable/disable specific tools |
| `command` | `dict[str, CommandConfig]` | Custom slash commands |
| `agent` | `dict[str, AgentConfig]` | Custom agents |
| `mcp` | `dict[str, McpConfig]` | MCP server configurations |
| `plugin` | `list[str]` | Plugins to enable |
| `instructions` | `list[str]` | Custom instructions for all sessions |
| `logLevel` | `"DEBUG" \| "INFO" \| "WARN" \| "ERROR"` | Log level |
| `permission` | `PermissionRuleset` | Permission rules for tools |

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
