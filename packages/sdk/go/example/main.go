package main

import (
	"context"
	"fmt"

	opencode "github.com/yunpat/sdk-go"
)

func main() {
	ctx := context.Background()

	// Client-only (connect to existing server)
	client := opencode.NewClient(&opencode.Config{
		BaseURL:   "http://localhost:4096",
		Directory: "/path/to/project",
	})

	// Health
	health, _ := client.Global.Health(ctx)
	fmt.Printf("Server: healthy=%v version=%s\n", health.Healthy, health.Version)

	// Projects (typed)
	projects, _ := client.Project.List(ctx)
	for _, p := range projects {
		fmt.Printf("Project: %s at %s\n", p.Name, p.Directory)
	}

	// Create a session (typed)
	session, _ := client.Session.Create(ctx, opencode.SessionCreateInput{
		Title: "My Go Session",
		Agent: "default",
	})
	fmt.Printf("Session: %s\n", session.ID)

	// Send a prompt (typed)
	client.Session.Prompt(ctx, session.ID, opencode.PromptInput{
		Parts: []opencode.PartInput{
			{Type: opencode.PartTypeText, Text: "Hello from Go SDK!"},
		},
	})

	// Shell command (typed)
	client.Session.Shell(ctx, session.ID, opencode.ShellInput{
		Agent:   "default",
		Command: "ls -la",
	})

	// Agents (typed response)
	agents, _ := client.Agent.List(ctx)
	for _, a := range agents {
		fmt.Printf("Agent: %s (%s)\n", a.Name, a.Description)
	}

	// Commands (typed response)
	commands, _ := client.Command.List(ctx)
	for _, c := range commands {
		fmt.Printf("Command: %s — %s\n", c.Name, c.Description)
	}

	// Shells (typed response)
	shells, _ := client.Pty.Shells(ctx)
	for _, s := range shells {
		fmt.Printf("Shell: %s (%s)\n", s.Name, s.Command)
	}

	// LSP status (typed)
	lsp, _ := client.LSP.Status(ctx)
	fmt.Printf("LSP servers: %d\n", len(lsp))

	// MCP status (typed)
	mcp, _ := client.MCP.Status(ctx)
	fmt.Printf("MCP servers: %d\n", len(mcp.Servers))

	// Formatter (typed)
	fmtF, _ := client.Formatter.Status(ctx)
	fmt.Printf("Formatter tools: %v\n", fmtF)

	// Permissions (typed)
	perms, _ := client.Permission.List(ctx)
	fmt.Printf("Pending permissions: %d\n", len(perms))

	// TUI (typed)
	client.TUI.ShowToast(ctx, opencode.TuiShowToastInput{
		Message:  "Hello from Go!",
		Variant:  "info",
		Duration: 3000,
	})
	client.TUI.ExecuteCommand(ctx, opencode.TuiExecuteCommandInput{
		Command: "agent_cycle",
	})

	// Providers (returns map since API structure varies)
	providers, _ := client.Provider.List(ctx)
	fmt.Printf("Providers: %v\n", providers)

	// OAuth (typed response)
	authResp, _ := client.Provider.OAuthAuthorize(ctx, "github")
	if authResp.AuthURL != "" {
		fmt.Printf("OAuth URL: %s\n", authResp.AuthURL)
	}

	// Workspaces (typed create)
	client.Experimental.WorkspaceCreate(ctx, opencode.WorkspaceCreateInput{
		Type:   "git",
		Branch: "main",
	})

	// Sync steal (typed)
	client.Sync.Steal(ctx, opencode.SyncStealInput{
		SessionID: session.ID,
	})

	// Subscribe to events (SSE)
	go client.Event.Subscribe(ctx, func(ev opencode.SSEEvent) error {
		fmt.Printf("[event] %s\n", ev.Event)
		return nil
	})

	// Keep alive for events
	select {}
}
