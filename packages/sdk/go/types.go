package opencode

// Config represents the client configuration.
type Config struct {
	BaseURL               string
	Directory             string
	ExperimentalWorkspace string
	Headers               map[string]string
}

// ServerOptions for createOpencodeServer.
type ServerOptions struct {
	Hostname  string
	Port      int
	Timeout   int
	Directory string
	Config    *Config
}

// TuiOptions for createOpencodeTui.
type TuiOptions struct {
	Project string
	Model   string
	Session string
	Agent   string
	Config  *Config
}

// MessageRole is the role of a message.
type MessageRole string

const (
	MessageRoleUser      MessageRole = "user"
	MessageRoleAssistant MessageRole = "assistant"
)

// UserMessage represents a user message.
type UserMessage struct {
	ID        string      `json:"id"`
	SessionID string      `json:"sessionID"`
	Role      MessageRole `json:"role"`
	Time      struct {
		Created int64 `json:"created"`
	} `json:"time"`
	Summary *MessageSummary `json:"summary,omitempty"`
	Agent   string          `json:"agent"`
	Model   ModelRef        `json:"model"`
	System  string          `json:"system,omitempty"`
	Tools   map[string]bool `json:"tools,omitempty"`
}

// AssistantMessage represents an assistant message.
type AssistantMessage struct {
	ID         string      `json:"id"`
	SessionID  string      `json:"sessionID"`
	Role       MessageRole `json:"role"`
	Time       struct {
		Created   int64 `json:"created"`
		Completed int64 `json:"completed,omitempty"`
	} `json:"time"`
	Error      *MessageError `json:"error,omitempty"`
	ParentID   string        `json:"parentID"`
	ModelID    string        `json:"modelID"`
	ProviderID string        `json:"providerID"`
	Mode       string        `json:"mode"`
	Path       struct {
		Cwd  string `json:"cwd"`
		Root string `json:"root"`
	} `json:"path"`
	Summary bool        `json:"summary,omitempty"`
	Cost    float64     `json:"cost"`
	Tokens  TokenUsage  `json:"tokens"`
	Finish  string      `json:"finish,omitempty"`
}

// TokenUsage tracks token counts.
type TokenUsage struct {
	Input     int       `json:"input"`
	Output    int       `json:"output"`
	Reasoning int       `json:"reasoning"`
	Cache     CacheUsage `json:"cache"`
}

// CacheUsage tracks cache reads and writes.
type CacheUsage struct {
	Read  int `json:"read"`
	Write int `json:"write"`
}

// Message is either a user or assistant message.
type Message struct {
	UserMessage      *UserMessage
	AssistantMessage *AssistantMessage
}

// MessageSummary summarizes a message.
type MessageSummary struct {
	Title string     `json:"title,omitempty"`
	Body  string     `json:"body,omitempty"`
	Diffs []FileDiff `json:"diffs"`
}

// FileDiff represents a file diff summary.
type FileDiff struct {
	File      string `json:"file"`
	Before    string `json:"before"`
	After     string `json:"after"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// MessageError wraps error details.
type MessageError struct {
	Name string                 `json:"name"`
	Data map[string]interface{} `json:"data"`
}

// ModelRef identifies a model.
type ModelRef struct {
	ProviderID string `json:"providerID"`
	ModelID    string `json:"modelID"`
}

// PartType identifies part types.
type PartType string

const (
	PartTypeText      PartType = "text"
	PartTypeReasoning PartType = "reasoning"
	PartTypeTool      PartType = "tool"
	PartTypeFile      PartType = "file"
	PartTypeStepStart PartType = "step-start"
	PartTypeStepFinish PartType = "step-finish"
)

// Part represents a message part.
type Part struct {
	ID         string                 `json:"id"`
	SessionID  string                 `json:"sessionID"`
	MessageID  string                 `json:"messageID"`
	Type       PartType               `json:"type"`
	Text       string                 `json:"text,omitempty"`
	Synthetic  bool                   `json:"synthetic,omitempty"`
	Ignored    bool                   `json:"ignored,omitempty"`
	Time       *PartTime              `json:"time,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	Tool       string                 `json:"tool,omitempty"`
	State      map[string]interface{} `json:"state,omitempty"`
}

// PartTime tracks part timing.
type PartTime struct {
	Start int64 `json:"start"`
	End   int64 `json:"end,omitempty"`
}

// FilePartSource contains file source info.
type FilePartSource struct {
	Text  FilePartSourceText `json:"text"`
	Type  string             `json:"type"`
}

// FilePartSourceText is text with range.
type FilePartSourceText struct {
	Value string `json:"value"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

// SessionInfo holds session metadata.
type SessionInfo struct {
	ID        string `json:"id"`
	Title     string `json:"title,omitempty"`
	ProjectID string `json:"projectID,omitempty"`
	Time      struct {
		Created int64 `json:"created"`
		Updated int64 `json:"updated,omitempty"`
	} `json:"time"`
}

// ProjectInfo holds project metadata.
type ProjectInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Directory string `json:"directory"`
}

// PtyInfo holds PTY session info.
type PtyInfo struct {
	ID      string `json:"id"`
	Command string `json:"command,omitempty"`
}

// ToolInfo holds tool metadata.
type ToolInfo struct {
	ID          string `json:"id"`
	Description string `json:"description,omitempty"`
}

// ProviderInfo holds provider metadata.
type ProviderInfo struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

// RequestOptions holds per-request options.
type RequestOptions struct {
	Query map[string]string
	Body  interface{}
}

// HealthResponse is the health check response.
type HealthResponse struct {
	Healthy bool   `json:"healthy"`
	Version string `json:"version,omitempty"`
}

// EventServerInstanceDisposed event.
type EventServerInstanceDisposed struct {
	Type       string `json:"type"`
	Properties struct {
		Directory string `json:"directory"`
	} `json:"properties"`
}

// EventInstallationUpdated event.
type EventInstallationUpdated struct {
	Type       string `json:"type"`
	Properties struct {
		Version string `json:"version"`
	} `json:"properties"`
}

// EventMessageUpdated event.
type EventMessageUpdated struct {
	Type       string  `json:"type"`
	Properties struct {
		Info Message `json:"info"`
	} `json:"properties"`
}

// EventMessageRemoved event.
type EventMessageRemoved struct {
	Type       string `json:"type"`
	Properties struct {
		SessionID string `json:"sessionID"`
		MessageID string `json:"messageID"`
	} `json:"properties"`
}

// SSEEvent represents a server-sent event.
type SSEEvent struct {
	Event string
	Data  []byte
	ID    string
	Retry int
}
