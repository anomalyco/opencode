package opencode

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

// SessionCreateInput is the request body for POST /session.
type SessionCreateInput struct {
	ParentID    string                 `json:"parentID,omitempty"`
	Title       string                 `json:"title,omitempty"`
	Agent       string                 `json:"agent,omitempty"`
	Model       *ModelRef              `json:"model,omitempty"`
	Permission  map[string]interface{} `json:"permission,omitempty"`
	WorkspaceID string                 `json:"workspaceID,omitempty"`
}

// SessionUpdateInput is the request body for PATCH /session/{id}.
type SessionUpdateInput struct {
	Title      string                 `json:"title,omitempty"`
	Permission map[string]interface{} `json:"permission,omitempty"`
}

// PromptInput is the request body for POST /session/{id}/message.
type PromptInput struct {
	MessageID string                 `json:"messageID,omitempty"`
	Model     *ModelRef              `json:"model,omitempty"`
	Agent     string                 `json:"agent,omitempty"`
	NoReply   bool                   `json:"noReply,omitempty"`
	Tools     map[string]bool        `json:"tools,omitempty"`
	System    string                 `json:"system,omitempty"`
	Variant   string                 `json:"variant,omitempty"`
	Parts     []PartInput            `json:"parts"`
}

// CommandInput is the request body for POST /session/{id}/command.
type CommandInput struct {
	MessageID string      `json:"messageID,omitempty"`
	Agent     string      `json:"agent,omitempty"`
	Model     string      `json:"model,omitempty"`
	Arguments string      `json:"arguments"`
	Command   string      `json:"command"`
	Variant   string      `json:"variant,omitempty"`
	Parts     []PartInput `json:"parts,omitempty"`
}

// ShellInput is the request body for POST /session/{id}/shell.
type ShellInput struct {
	MessageID string    `json:"messageID,omitempty"`
	Agent     string    `json:"agent"`
	Model     *ModelRef `json:"model,omitempty"`
	Command   string    `json:"command"`
}

// PtyCreateInput is the request body for POST /pty.
type PtyCreateInput struct {
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Cwd     string            `json:"cwd,omitempty"`
	Title   string            `json:"title,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// TuiExecuteCommandInput is the request body for POST /tui/execute-command.
type TuiExecuteCommandInput struct {
	Command string `json:"command"`
}

// TuiShowToastInput is the request body for POST /tui/show-toast.
type TuiShowToastInput struct {
	Title    string `json:"title,omitempty"`
	Message  string `json:"message"`
	Variant  string `json:"variant"`
	Duration int    `json:"duration,omitempty"`
}

// SyncReplayInput is the request body for POST /sync/replay.
type SyncReplayInput struct {
	Directory string                   `json:"directory"`
	Events    []map[string]interface{} `json:"events"`
}

// SyncStealInput is the request body for POST /sync/steal.
type SyncStealInput struct {
	SessionID string `json:"sessionID"`
}

// WorkspaceCreateInput is the request body for POST /experimental/workspace.
type WorkspaceCreateInput struct {
	ID     string `json:"id,omitempty"`
	Type   string `json:"type"`
	Branch string `json:"branch"` // TODO: verify field name in schema
}

// PermissionReplyInput is the request body for POST /permission/{id}/reply.
type PermissionReplyInput struct {
	Reply   string `json:"reply"`
	Message string `json:"message,omitempty"`
}

// QuestionReplyInput is the request body for POST /question/{id}/reply.
type QuestionReplyInput struct {
	Answers []map[string]interface{} `json:"answers"`
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

// SessionStatusResponse is the response for GET /session/status.
type SessionStatusResponse struct {
	Active   bool   `json:"active"`
	SessionID string `json:"sessionID,omitempty"`
}

// GlobalConfigResponse is the response for GET /global/config.
type GlobalConfigResponse struct {
	Version string `json:"version,omitempty"`
}

// PtyShellInfo describes an available shell.
type PtyShellInfo struct {
	Name    string `json:"name"`
	Command string `json:"command"`
	Args    []string `json:"args,omitempty"`
}

// VCSStatusResponse is the response for GET /vcs.
type VCSStatusResponse struct {
	Branch    string   `json:"branch,omitempty"`
	IsDirty   bool     `json:"isDirty,omitempty"`
	RemoteURL string   `json:"remoteURL,omitempty"`
	Files     []string `json:"files,omitempty"`
}

// AgentInfo describes an available agent.
type AgentInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Mode        string `json:"mode,omitempty"`
	Hidden      bool   `json:"hidden,omitempty"`
	Native      bool   `json:"native,omitempty"`
}

// ProviderAuthResponse is the response for OAuth authorization.
type ProviderAuthResponse struct {
	AuthURL string `json:"authURL,omitempty"`
	Status  string `json:"status,omitempty"`
}

// SkillInfo describes an available skill.
type SkillInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Path        string `json:"path,omitempty"`
}

// CommandInfo describes an available command.
type CommandInfo struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Agent       string   `json:"agent,omitempty"`
	Template    string   `json:"template,omitempty"`
	Hints       []string `json:"hints,omitempty"`
}

// LSPStatusResponse is the response for GET /lsp.
type LSPStatusResponse struct {
	Servers []LSPServerInfo `json:"servers,omitempty"`
}

// LSPServerInfo describes an LSP server.
type LSPServerInfo struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Name    string `json:"name,omitempty"`
}

// MCPStatusResponse is the response for GET /mcp.
type MCPStatusResponse struct {
	Servers []MCPStatusInfo `json:"servers,omitempty"`
}

// MCPStatusInfo describes an MCP server status.
type MCPStatusInfo struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

// FormatterStatusResponse is the response for GET /formatter.
type FormatterStatusResponse struct {
	Available bool     `json:"available"`
	Tools     []string `json:"tools,omitempty"`
}

// ConsoleInfo describes the active Console provider.
type ConsoleInfo struct {
	Provider string `json:"provider,omitempty"`
	Org      string `json:"org,omitempty"`
}

// WorkspaceInfo describes a workspace.
type WorkspaceInfo struct {
	ID       string `json:"id"`
	Type     string `json:"type,omitempty"`
	Branch   string `json:"branch,omitempty"`
	Status   string `json:"status,omitempty"`
}

// WorktreeInfo describes a worktree.
type WorktreeInfo struct {
	Name   string `json:"name"`
	Path   string `json:"path,omitempty"`
	Branch string `json:"branch,omitempty"`
}

// PermissionInfo describes a pending permission request.
type PermissionInfo struct {
	ID          string `json:"id"`
	SessionID   string `json:"sessionID"`
	Tool        string `json:"tool,omitempty"`
	Description string `json:"description,omitempty"`
}

// SyncEvent describes a sync event.
type SyncEvent struct {
	ID        string `json:"id,omitempty"`
	Type      string `json:"type"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
}

// SyncStartResponse is the response for POST /sync/start.
type SyncStartResponse struct {
	SessionID string `json:"sessionID"`
	Status    string `json:"status"`
}

// FileInfo describes a file listing entry.
type FileInfo struct {
	Path  string `json:"path"`
	Type  string `json:"type,omitempty"`
	Size  int64  `json:"size,omitempty"`
}
