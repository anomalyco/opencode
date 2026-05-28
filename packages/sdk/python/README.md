# OpenCode Python SDK

Python SDK for [OpenCode](https://opencode.ai) - the open source AI coding agent.

## Installation

```bash
pip install opencode-ai
```

## Usage

### High-level API (server + client in one)

```python
from opencode_sdk import create_opencode

client, server = create_opencode(port=4096)

# Check server health
print(client.health())

# Create a session
session = client.session_create()
session_id = session["id"]

# Send a prompt
result = client.session_prompt(session_id, "Hello, what can you do?")
print(result)

# Clean up
server.close()
```

### Client only (connect to existing server)

```python
from opencode_sdk import create_opencode_client

client = create_opencode_client(
    base_url="http://127.0.0.1:4096",
    directory="/path/to/project",
)

# List sessions
sessions = client.session_list()
for s in sessions:
    print(f"Session: {s['id']}")

# Read a file
content = client.file_read(path="src/main.py")
print(content)
```

### Server only (manage lifecycle yourself)

```python
from opencode_sdk.server import create_opencode_server

server = create_opencode_server(port=4096, config={"model": "claude-sonnet-4-20250514"})
print(f"Server running at {server.url}")

# ... use the server from any client ...

server.close()
```

## API

The `OpendcodeClient` provides access to all OpenCode HTTP API endpoints:

| Category | Methods |
|----------|---------|
| **Global** | `health()`, `global_event()`, `global_dispose()`, `global_upgrade()` |
| **Config** | `config_get()`, `config_update()`, `config_providers()`, `global_config_get()`, `global_config_update()` |
| **Session** | `session_create()`, `session_get()`, `session_list()`, `session_prompt()`, `session_messages()`, `session_delete()`, `session_fork()`, `session_share()`, `session_diff()`, `session_status()`, `session_abort()`, and more |
| **Auth** | `auth_set()`, `auth_remove()` |
| **File** | `file_read()`, `file_list()`, `file_status()` |
| **Find** | `find_text()`, `find_files()`, `find_symbols()` |
| **VCS** | `vcs_get()`, `vcs_status()`, `vcs_diff()`, `vcs_apply()` |
| **MCP** | `mcp_list()`, `mcp_connect()`, `mcp_disconnect()`, `mcp_status()`, `mcp_add()` |
| **Tool** | `tool_list()`, `tool_ids()` |
| **And more** | LSP, formatter, provider, permission, question, pty, worktree, workspace, sync, TUI |

## Development

Requires Python 3.10+.

```bash
# Create virtual environment
py -3.13 -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Or activate (macOS/Linux)
# source .venv/bin/activate

# Install dependencies in editable mode
pip install -e ".[dev]"

# Run tests
pytest

# Generate SDK from OpenAPI spec
python scripts/generate.py
```

## License

MIT
