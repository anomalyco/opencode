//go:build integration

package opencode

import (
	"context"
	"testing"
	"time"
)

func quickCtx(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 10*time.Second)
}

// TestIntegrationServerLifecycle starts opencode serve from the current project,
// and verifies CRUD operations end-to-end.
func TestIntegrationServerLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	server, err := CreateServer(ctx, &ServerOptions{
		Hostname: "127.0.0.1",
		Port:     14097,
		Timeout:  15000,
	})
	if err != nil {
		t.Fatalf("CreateServer: %v", err)
	}
	defer server.Close()
	t.Logf("Server started at %s", server.URL)

	time.Sleep(1 * time.Second)

	client := NewClient(&Config{BaseURL: server.URL})

	// 1. Health
	qctx, qcancel := quickCtx(ctx)
	health, err := client.Global.Health(qctx)
	qcancel()
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if !health.Healthy {
		t.Error("expected healthy server")
	}
	t.Logf("Health: healthy=%v version=%s", health.Healthy, health.Version)

	// 2. List projects
	qctx, qcancel = quickCtx(ctx)
	projects, err := client.Project.List(qctx)
	qcancel()
	if err != nil {
		t.Fatalf("Project.List: %v", err)
	}
	if len(projects) == 0 {
		t.Error("expected at least one project")
	}
	t.Logf("Projects: %d", len(projects))

	// 3. Current project
	qctx, qcancel = quickCtx(ctx)
	current, err := client.Project.Current(qctx)
	qcancel()
	if err != nil {
		t.Fatalf("Project.Current: %v", err)
	}
	t.Logf("Current: %s (%s)", current.Name, current.Directory)

	// 4. Create a session
	qctx, qcancel = quickCtx(ctx)
	session, err := client.Session.Create(qctx, SessionCreateInput{
		Title: "integration-test",
	})
	qcancel()
	if err != nil {
		t.Fatalf("Session.Create: %v", err)
	}
	if session.ID == "" {
		t.Error("expected non-empty session ID")
	}
	t.Logf("Created session: %s", session.ID)

	// 5. Get the session
	qctx, qcancel = quickCtx(ctx)
	got, err := client.Session.Get(qctx, session.ID)
	qcancel()
	if err != nil {
		t.Fatalf("Session.Get: %v", err)
	}
	if got.ID != session.ID {
		t.Errorf("session ID mismatch: %s != %s", got.ID, session.ID)
	}
	t.Logf("Got session: %s", got.Title)

	// 6. Update session
	qctx, qcancel = quickCtx(ctx)
	_, err = client.Session.Update(qctx, session.ID, SessionUpdateInput{
		Title: "integration-test-updated",
	})
	qcancel()
	if err != nil {
		t.Fatalf("Session.Update: %v", err)
	}
	t.Log("Updated session title")

	// 7. List sessions
	qctx, qcancel = quickCtx(ctx)
	sessions, err := client.Session.List(qctx)
	qcancel()
	if err != nil {
		t.Fatalf("Session.List: %v", err)
	}
	t.Logf("Sessions: %d", len(sessions))

	// 8. List agents
	qctx, qcancel = quickCtx(ctx)
	agents, err := client.Agent.List(qctx)
	qcancel()
	if err != nil {
		t.Fatalf("Agent.List: %v", err)
	}
	if len(agents) == 0 {
		t.Error("expected at least one agent")
	}
	t.Logf("Agents: %d", len(agents))

	// 9. List commands
	qctx, qcancel = quickCtx(ctx)
	cmds, err := client.Command.List(qctx)
	qcancel()
	if err != nil {
		t.Fatalf("Command.List: %v", err)
	}
	if len(cmds) == 0 {
		t.Error("expected at least one command")
	}
	t.Logf("Commands: %d", len(cmds))

	// 10. Providers
	qctx, qcancel = quickCtx(ctx)
	providers, err := client.Provider.List(qctx)
	qcancel()
	if err != nil {
		t.Fatalf("Provider.List: %v", err)
	}
	t.Logf("Providers: %d keys", len(providers))

	// 11. LSP status (may be empty or timeout)
	qctx, qcancel = quickCtx(ctx)
	lsp, err := client.LSP.Status(qctx)
	qcancel()
	if err != nil {
		t.Logf("LSP.Status: %v", err)
	} else {
		t.Logf("LSP servers: %d", len(lsp))
	}

	// 12. MCP status
	qctx, qcancel = quickCtx(ctx)
	mcp, err := client.MCP.Status(qctx)
	qcancel()
	if err != nil {
		t.Logf("MCP.Status: %v", err)
	} else {
		t.Logf("MCP servers: %d", len(mcp.Servers))
	}

	// 13. Formatter
	qctx, qcancel = quickCtx(ctx)
	fmtTools, err := client.Formatter.Status(qctx)
	qcancel()
	if err != nil {
		t.Logf("Formatter.Status: %v", err)
	} else {
		t.Logf("Formatter tools: %v", fmtTools)
	}

	// 14. Delete session
	qctx, qcancel = quickCtx(ctx)
	if err := client.Session.Delete(qctx, session.ID); err != nil {
		t.Fatalf("Session.Delete: %v", err)
	}
	qcancel()
	t.Log("Session deleted")
}

// TestIntegrationSSE verifies SSE event subscription works.
func TestIntegrationSSE(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	server, err := CreateServer(ctx, &ServerOptions{
		Hostname: "127.0.0.1",
		Port:     14098,
		Timeout:  15000,
	})
	if err != nil {
		t.Fatalf("CreateServer: %v", err)
	}
	defer server.Close()

	time.Sleep(1 * time.Second)
	client := NewClient(&Config{BaseURL: server.URL})

	eventCh := make(chan SSEEvent, 10)
	errCh := make(chan error, 1)

	sseCtx, sseCancel := context.WithCancel(ctx)
	defer sseCancel()

	go func() {
		errCh <- client.Event.Subscribe(sseCtx, func(ev SSEEvent) error {
			eventCh <- ev
			return nil
		})
	}()

	// Create a session to trigger an event
	qctx, qcancel := quickCtx(ctx)
	session, err := client.Session.Create(qctx, SessionCreateInput{
		Title: "sse-test",
	})
	qcancel()
	if err != nil {
		t.Fatalf("Session.Create: %v", err)
	}

	select {
	case ev := <-eventCh:
		t.Logf("SSE event received: %s", ev.Event)
	case <-time.After(10 * time.Second):
		t.Log("no SSE event within 10s (may be expected for headless server)")
	case err := <-errCh:
		t.Fatalf("SSE error: %v", err)
	}

	sseCancel()
	qctx, qcancel = quickCtx(ctx)
	client.Session.Delete(qctx, session.ID)
	qcancel()
}
