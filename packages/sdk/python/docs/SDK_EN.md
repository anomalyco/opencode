# Python SDK

Type-safe Python client for OpenCode server.

The OpenCode Python SDK provides a type-safe client for interacting with the server. Use it to build integrations and control OpenCode programmatically.

---

## Install

Install the SDK from PyPI:

```bash
pip install opencode-sdk
```

---

## Create client

Create an instance of OpenCode:

```python
from opencode_sdk import create_opencode

opencode = create_opencode()
client = opencode.client
```

This starts both a server and a client.

### Options

| Option     | Type     | Description                         | Default     |
| ---------- | -------- | ----------------------------------- | ----------- |
| `hostname` | `str`    | Server hostname                     | `127.0.0.1` |
| `port`     | `int`    | Server port                         | `4096`      |
| `timeout`  | `float`  | Timeout in seconds for server start | `5.0`       |
| `config`   | `Config` | Configuration object                | `None`      |

---

## Config

You can pass a configuration object to customize behavior:

```python
from opencode_sdk import create_opencode

opencode = create_opencode(
    hostname="127.0.0.1",
    port=4096,
    config={"model": "anthropic/claude-3-5-sonnet-20241022"},
)

print(f"Server running at {opencode.server.url}")
opencode.close()
```

---

## Async Usage

For async applications:

```python
import asyncio
from opencode_sdk import create_opencode_async

async def main():
    opencode = await create_opencode_async()
    client = opencode.client

    # Use async methods
    sessions = await client.session.list_async()

    await opencode.aclose()

asyncio.run(main())
```

---

## Client only

If you already have a running instance of OpenCode, create a client to connect to it:

```python
from opencode_sdk import create_opencode_client

client = create_opencode_client(base_url="http://localhost:4096")
```

### Options

| Option      | Type    | Description                        | Default                 |
| ----------- | ------- | ---------------------------------- | ----------------------- |
| `base_url`  | `str`   | URL of the server                  | `http://127.0.0.1:4096` |
| `timeout`   | `float` | Request timeout in seconds         | `None`                  |
| `headers`   | `dict`  | Additional headers                 | `{}`                    |
| `directory` | `str`   | Default directory for the instance | `None`                  |

---

## Types

The SDK includes type definitions for all API types. Import them directly:

```python
from opencode_sdk import Session, Message, Part, Config
```

All types are defined as TypedDict classes in the [types file](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/python/opencode_sdk/types.py).

---

## Response Handling

All API methods return a `Response` object with `ok`, `data`, and `error` properties:

```python
response = client.session.list()

if response.ok:
    sessions = response.data
    for session in sessions:
        print(session["id"], session["title"])
else:
    print(f"Error: {response.error}")
```

---

## APIs

The SDK exposes all server APIs through a type-safe client.

---

### App

| Method                             | Description               | Response  |
| ---------------------------------- | ------------------------- | --------- |
| `app.log(service, level, message)` | Write a log entry         | `bool`    |
| `app.agents()`                     | List all available agents | `Agent[]` |

#### Examples

```python
# Write a log entry
client.app.log(service="my-app", level="info", message="Operation completed")

# List available agents
agents = client.app.agents()
if agents.ok:
    for agent in agents.data:
        print(agent["name"])
```

---

### Project

| Method              | Description         | Response    |
| ------------------- | ------------------- | ----------- |
| `project.list()`    | List all projects   | `Project[]` |
| `project.current()` | Get current project | `Project`   |

#### Examples

```python
# List all projects
projects = client.project.list()

# Get current project
current = client.project.current()
if current.ok:
    print(current.data["path"])
```

---

### Path

| Method       | Description      | Response   |
| ------------ | ---------------- | ---------- |
| `path.get()` | Get current path | `PathInfo` |

#### Examples

```python
path_info = client.path.get()
if path_info.ok:
    print(path_info.data)
```

---

### Config

| Method               | Description                       | Response               |
| -------------------- | --------------------------------- | ---------------------- |
| `config.get()`       | Get config info                   | `Config`               |
| `config.providers()` | List providers and default models | `ProviderListResponse` |

#### Examples

```python
config = client.config.get()

providers = client.config.providers()
if providers.ok:
    for provider in providers.data["providers"]:
        print(provider["name"])
```

---

### Sessions

| Method                                                    | Description                        | Response                    |
| --------------------------------------------------------- | ---------------------------------- | --------------------------- |
| `session.list()`                                          | List sessions                      | `Session[]`                 |
| `session.get(id)`                                         | Get session                        | `Session`                   |
| `session.children(id)`                                    | List child sessions                | `Session[]`                 |
| `session.create(title, parent_id)`                        | Create session                     | `Session`                   |
| `session.delete(id)`                                      | Delete session                     | `bool`                      |
| `session.update(id, title)`                               | Update session properties          | `Session`                   |
| `session.init(id, ...)`                                   | Analyze app and create `AGENTS.md` | `bool`                      |
| `session.abort(id)`                                       | Abort a running session            | `bool`                      |
| `session.share(id)`                                       | Share session                      | `Session`                   |
| `session.unshare(id)`                                     | Unshare session                    | `Session`                   |
| `session.summarize(id, ...)`                              | Summarize session                  | `bool`                      |
| `session.messages(id, limit)`                             | List messages in a session         | `MessageWithParts[]`        |
| `session.message(id, message_id)`                         | Get message details                | `MessageWithParts`          |
| `session.prompt(id, parts, ...)`                          | Send prompt message                | `AssistantMessageWithParts` |
| `session.command(id, command, arguments)`                 | Send command to session            | `AssistantMessageWithParts` |
| `session.shell(id, agent, command)`                       | Run a shell command                | `AssistantMessageWithParts` |
| `session.revert(id, message_id)`                          | Revert a message                   | `Session`                   |
| `session.unrevert(id)`                                    | Restore reverted messages          | `Session`                   |
| `session.permission_respond(id, permission_id, response)` | Respond to permission request      | `bool`                      |

#### Examples

```python
# Create and manage sessions
session = client.session.create(title="My session")
if session.ok:
    session_id = session.data["id"]

sessions = client.session.list()

# Send a prompt message
result = client.session.prompt(
    session_id,
    parts=[{"type": "text", "text": "Hello!"}],
    model={"providerID": "anthropic", "modelID": "claude-3-5-sonnet-20241022"},
)

if result.ok:
    for part in result.data["parts"]:
        if part.get("type") == "text":
            print(part["text"])

# Inject context without triggering AI response (useful for plugins)
client.session.prompt(
    session_id,
    parts=[{"type": "text", "text": "You are a helpful assistant."}],
    no_reply=True,
)

# Delete session
client.session.delete(session_id)
```

---

### Files

| Method                           | Description                        | Response       |
| -------------------------------- | ---------------------------------- | -------------- |
| `find.text(pattern)`             | Search for text in files           | `FindMatch[]`  |
| `find.files(query, dirs, limit)` | Find files and directories by name | `str[]`        |
| `find.symbols(query)`            | Find workspace symbols             | `Symbol[]`     |
| `file.read(path)`                | Read a file                        | `FileContent`  |
| `file.list(path)`                | List files in directory            | `FileNode[]`   |
| `file.status()`                  | Get status for tracked files       | `FileStatus[]` |

#### Examples

```python
# Search for text in files
results = client.find.text(pattern="def.*opencode")

# Find files
files = client.find.files(query="*.py")
if files.ok:
    for path in files.data:
        print(path)

# Find directories
dirs = client.find.files(query="packages", dirs=True, limit=20)

# Read a file
content = client.file.read(path="src/main.py")
if content.ok:
    print(content.data["content"])
```

---

### TUI

| Method                                              | Description               | Response |
| --------------------------------------------------- | ------------------------- | -------- |
| `tui.append_prompt(text)`                           | Append text to the prompt | `bool`   |
| `tui.open_help()`                                   | Open the help dialog      | `bool`   |
| `tui.open_sessions()`                               | Open the session selector | `bool`   |
| `tui.open_themes()`                                 | Open the theme selector   | `bool`   |
| `tui.open_models()`                                 | Open the model selector   | `bool`   |
| `tui.submit_prompt()`                               | Submit the current prompt | `bool`   |
| `tui.clear_prompt()`                                | Clear the prompt          | `bool`   |
| `tui.execute_command(command)`                      | Execute a command         | `bool`   |
| `tui.show_toast(message, variant, title, duration)` | Show toast notification   | `bool`   |

#### Examples

```python
# Control TUI interface
client.tui.append_prompt(text="Add this to prompt")

client.tui.show_toast(message="Task completed", variant="success")
```

---

### Auth

| Method               | Description                    | Response |
| -------------------- | ------------------------------ | -------- |
| `auth.set(id, auth)` | Set authentication credentials | `bool`   |

#### Examples

```python
client.auth.set(
    id="anthropic",
    auth={"type": "api", "key": "your-api-key"},
)
```

---

### Events

| Method              | Description               | Response             |
| ------------------- | ------------------------- | -------------------- |
| `event.subscribe()` | Server-sent events stream | `Iterator[SseEvent]` |

#### Examples

```python
# Listen to real-time events (sync)
for event in client.event.subscribe():
    print(f"Event: {event.event}, Data: {event.data}")

# Async version
async for event in client.event.subscribe_async():
    print(f"Event: {event.event}, Data: {event.data}")
```

---

### MCP (Model Context Protocol)

| Method                          | Description                     | Response         |
| ------------------------------- | ------------------------------- | ---------------- |
| `mcp.status()`                  | Get MCP server status           | `McpStatus`      |
| `mcp.add(name, config)`         | Add MCP server dynamically      | `bool`           |
| `mcp.connect(name)`             | Connect an MCP server           | `bool`           |
| `mcp.disconnect(name)`          | Disconnect an MCP server        | `bool`           |
| `mcp.auth.start(name)`          | Start OAuth flow                | `str` (auth URL) |
| `mcp.auth.callback(name, code)` | Complete OAuth with code        | `bool`           |
| `mcp.auth.authenticate(name)`   | Full OAuth flow (opens browser) | `bool`           |
| `mcp.auth.remove(name)`         | Remove OAuth credentials        | `bool`           |

#### Examples

```python
# Add and connect MCP server
client.mcp.add(
    name="my-mcp",
    config={"type": "local", "command": "npx", "args": ["-y", "my-mcp-server"]},
)
client.mcp.connect("my-mcp")

# Check status
status = client.mcp.status()
if status.ok:
    for server in status.data["servers"]:
        print(f"{server['name']}: {server['status']}")

# Disconnect
client.mcp.disconnect("my-mcp")
```

---

### Provider

| Method                                      | Description               | Response               |
| ------------------------------------------- | ------------------------- | ---------------------- |
| `provider.list()`                           | List all providers        | `Provider[]`           |
| `provider.auth()`                           | Get provider auth methods | `ProviderAuthMethod[]` |
| `provider.oauth.authorize(id, method)`      | Start OAuth authorization | `str` (auth URL)       |
| `provider.oauth.callback(id, method, code)` | Complete OAuth callback   | `bool`                 |

#### Examples

```python
# List providers
providers = client.provider.list()
if providers.ok:
    for provider in providers.data:
        print(provider["id"], provider["name"])

# Get auth methods
auth_methods = client.provider.auth()
```

---

### PTY (Pseudo Terminal)

| Method                                  | Description            | Response |
| --------------------------------------- | ---------------------- | -------- |
| `pty.list()`                            | List all PTY sessions  | `Pty[]`  |
| `pty.create(command, args, cwd, title)` | Create PTY session     | `Pty`    |
| `pty.get(id)`                           | Get PTY session info   | `Pty`    |
| `pty.remove(id)`                        | Remove PTY session     | `bool`   |
| `pty.update(id, title, size)`           | Update PTY session     | `Pty`    |
| `pty.connect(id)`                       | Connect to PTY session | `bool`   |

#### Examples

```python
# Create a PTY session
pty = client.pty.create(command="bash", args=["-l"], title="My Terminal")
if pty.ok:
    pty_id = pty.data["id"]

# List PTY sessions
sessions = client.pty.list()

# Remove PTY session
client.pty.remove(pty_id)
```

---

### LSP & Formatter

| Method               | Description           | Response          |
| -------------------- | --------------------- | ----------------- |
| `lsp.status()`       | Get LSP server status | `LspStatus`       |
| `formatter.status()` | Get formatter status  | `FormatterStatus` |

#### Examples

```python
# Check LSP status
lsp_status = client.lsp.status()
if lsp_status.ok:
    for server in lsp_status.data.get("servers", []):
        print(f"{server['name']}: {server['status']}")

# Check formatter status
formatter_status = client.formatter.status()
```

---

### VCS (Version Control)

| Method      | Description                       | Response  |
| ----------- | --------------------------------- | --------- |
| `vcs.get()` | Get VCS info for current instance | `VcsInfo` |

#### Examples

```python
vcs = client.vcs.get()
if vcs.ok:
    print(f"Branch: {vcs.data.get('branch')}")
    print(f"Dirty: {vcs.data.get('dirty')}")
```

---

## Complete Example

```python
from opencode_sdk import create_opencode

# Start server and client
opencode = create_opencode()
client = opencode.client

try:
    # Create a session
    session = client.session.create(title="My Chat")
    if not session.ok:
        print(f"Failed to create session: {session.error}")
        exit(1)

    session_id = session.data["id"]
    print(f"Created session: {session_id}")

    # Send a prompt
    response = client.session.prompt(
        session_id,
        parts=[{"type": "text", "text": "What is Python?"}],
    )

    if response.ok:
        for part in response.data["parts"]:
            if part.get("type") == "text":
                print(f"Assistant: {part['text']}")

    # List all sessions
    sessions = client.session.list()
    if sessions.ok:
        print(f"\nTotal sessions: {len(sessions.data)}")

finally:
    # Cleanup
    opencode.close()
```

---

## Async Complete Example

```python
import asyncio
from opencode_sdk import create_opencode_async

async def main():
    opencode = await create_opencode_async()
    client = opencode.client

    try:
        # Create a session
        session = await client.session.create_async(title="Async Chat")
        if not session.ok:
            print(f"Failed: {session.error}")
            return

        session_id = session.data["id"]

        # Send a prompt
        response = await client.session.prompt_async(
            session_id,
            parts=[{"type": "text", "text": "Hello!"}],
        )

        if response.ok:
            for part in response.data["parts"]:
                if part.get("type") == "text":
                    print(part["text"])

    finally:
        await opencode.aclose()

asyncio.run(main())
```
