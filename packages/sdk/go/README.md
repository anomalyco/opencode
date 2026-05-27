# @yunpat/sdk-go

Go SDK for the [opencode](https://github.com/xujian519/yunpat-ts) API. Zero external dependencies — pure Go standard library.

## Install

```bash
go get github.com/yunpat/sdk-go
```

## Quick Start

### Client + Server (SDK manages the server lifecycle)

```go
package main

import (
    "context"
    "log"

    opencode "github.com/yunpat/sdk-go"
)

func main() {
    ctx := context.Background()

    oc, err := opencode.Create(ctx, &opencode.ServerOptions{
        Port: 4096,
    })
    if err != nil {
        log.Fatal(err)
    }
    defer oc.Close()

    sessions, _ := oc.Client.Session.List(ctx)
    log.Printf("Found %d sessions", len(sessions))
}
```

### Client-Only (connect to an existing server)

```go
client := opencode.NewClient(&opencode.Config{
    BaseURL:   "http://localhost:4096",
    Directory: "/path/to/project",
})

projects, _ := client.Project.List(ctx)
```

## API Reference

The client is organized into sub-clients mirroring the REST API:

| Client | Purpose |
|--------|---------|
| `Global` | Health checks, events, config |
| `Project` | Project listing and management |
| `Pty` | PTY session lifecycle |
| `Config` | Runtime configuration |
| `Tool` | Tool discovery |
| `Session` | Full session CRUD, prompts, diffs, revert |
| `API` | v2 API session endpoints |
| `Command` | Available commands |
| `Provider` | Provider listing, auth, OAuth |
| `Find` | Text, file, and symbol search |
| `File` | File listing, reading, status |
| `MCP` | MCP server management |
| `TUI` | TUI control (prompts, toasts, dialogs) |
| `Auth` | Authentication credentials |
| `Event` | SSE event subscription |
| `Experimental` | Console, workspaces, worktrees |

### Session Operations

```go
// Create
session, _ := client.Session.Create(ctx, map[string]interface{}{
    "title": "My Session",
})

// Send a prompt (typed)
client.Session.Prompt(ctx, session.ID, opencode.PromptInput{
    Parts: []opencode.PartInput{
        {Type: opencode.PartTypeText, Text: "Hello!"},
    },
})

// Get diff
diffs, _ := client.Session.Diff(ctx, session.ID)

// Abort a running session
client.Session.Abort(ctx, session.ID)
```

### Event Subscription (SSE)

```go
go client.Event.Subscribe(ctx, func(ev opencode.SSEEvent) error {
    log.Printf("[%s] %s", ev.Event, string(ev.Data))
    return nil
})
```

### Search

```go
// Find files by name
results, _ := client.Find.Files(ctx, "*.go")

// Find symbols
symbols, _ := client.Find.Symbols(ctx, "createOpencode")
```

## Message Construction

```go
msg := opencode.BuildUserMessage(opencode.UserMessageInput{
    SessionID: session.ID,
    Agent:     "default",
    Model:     opencode.ModelRef{ProviderID: "openai", ModelID: "gpt-4"},
})

parts := opencode.BuildParts(msg.ID, msg.SessionID, []opencode.PartInput{
    {Type: opencode.PartTypeText, Text: "Write a function"},
})
```

## Typed Request Structs

Core endpoints use typed request structs instead of `map[string]interface{}`:

| Struct | Used By |
|--------|---------|
| `SessionCreateInput` | `Session.Create` |
| `SessionUpdateInput` | `Session.Update` |
| `PromptInput` | `Session.Prompt`, `Session.PromptAsync` |
| `CommandInput` | `Session.Command` |
| `ShellInput` | `Session.Shell` |
| `PtyCreateInput` | `Pty.Create` |
| `TuiExecuteCommandInput` | `TUI.ExecuteCommand` |
| `TuiShowToastInput` | `TUI.ShowToast` |
| `PermissionReplyInput` | `Permission.Reply` |
| `QuestionReplyInput` | `Question.Reply` |
| `WorkspaceCreateInput` | `Experimental.WorkspaceCreate` |
| `SyncReplayInput` | `Sync.Replay` |
| `SyncStealInput` | `Sync.Steal` |

## All Methods

Every method accepts `context.Context` as its first argument. All 124 endpoints from the OpenAPI spec are covered.

```go
client.Global.Health(ctx)
client.Global.Event(ctx, handler)
client.Project.List(ctx)
client.Project.Current(ctx)
client.Project.InitGit(ctx, "project-id")
client.Session.List(ctx)
client.Session.Create(ctx, body)
client.Session.Prompt(ctx, id, body)
client.Session.PromptAsync(ctx, id, body)
client.Session.Command(ctx, id, body)
client.Session.Shell(ctx, id, body)
client.Session.Diff(ctx, id)
client.Session.Summarize(ctx, id)
client.Session.Fork(ctx, id)
client.Session.Abort(ctx, id)
client.Session.Revert(ctx, id)
client.Session.Unrevert(ctx, id)
client.Session.Share(ctx, id)
client.Session.Unshare(ctx, id)
client.Pty.Create(ctx, body)
client.Pty.Connect(ctx, id)
client.Pty.ConnectToken(ctx, id)
client.Config.Get(ctx)
client.Config.Update(ctx, body)
client.Config.Providers(ctx)
client.Provider.List(ctx)
client.Provider.OAuthAuthorize(ctx, "github")
client.Provider.OAuthCallback(ctx, "github", body)
client.Find.Text(ctx, "query")
client.Find.Files(ctx, "*.go")
client.Find.Symbols(ctx, "funcName")
client.File.Read(ctx, "/path/to/file")
client.File.Status(ctx, "/path/to/file")
client.MCP.Status(ctx)
client.MCP.Connect(ctx, "server-name")
client.MCP.Disconnect(ctx, "server-name")
client.TUI.ShowToast(ctx, body)
client.TUI.SubmitPrompt(ctx)
client.TUI.ExecuteCommand(ctx, "agent_cycle")
client.Auth.Set(ctx, "provider-id", body)
client.Auth.Remove(ctx, "provider-id")
client.Event.Subscribe(ctx, handler)
client.Experimental.WorkspaceList(ctx)
client.Experimental.WorktreeCreate(ctx, body)
client.Permission.Reply(ctx, requestID, body)
client.Sync.Start(ctx, body)
client.Sync.History(ctx, body)
```

## License

MIT
