package opencode

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Client is the opencode API client.
type Client struct {
	baseURL   string
	http      *http.Client
	headers   map[string]string
	directory string
	workspace string

	Global       *GlobalClient
	Project      *ProjectClient
	Pty          *PtyClient
	Config       *ConfigClient
	Tool         *ToolClient
	Instance     *InstanceClient
	Path         *PathClient
	VCS          *VCSClient
	Session      *SessionClient
	API          *APIClient
	Command      *CommandClient
	Provider     *ProviderClient
	Find         *FindClient
	File         *FileClient
	App          *AppClient
	MCP          *MCPClient
	LSP          *LSPClient
	Formatter    *FormatterClient
	TUI          *TUIClient
	Auth         *AuthClient
	Event        *EventClient
	Experimental *ExperimentalClient
	Permission   *PermissionClient
	Question     *QuestionClient
	Sync         *SyncClient
	Skill        *SkillClient
	Agent        *AgentClient
}

// NewClient creates a new opencode API client.
func NewClient(opts *Config) *Client {
	if opts == nil {
		opts = &Config{}
	}
	baseURL := opts.BaseURL
	if baseURL == "" {
		baseURL = "http://localhost:4096"
	}

	c := &Client{
		baseURL:   baseURL,
		http:      &http.Client{},
		headers:   opts.Headers,
		directory: opts.Directory,
		workspace: opts.ExperimentalWorkspace,
	}
	if c.headers == nil {
		c.headers = make(map[string]string)
	}
	if c.directory != "" {
		c.headers["x-opencode-directory"] = url.QueryEscape(c.directory)
	}
	if c.workspace != "" {
		c.headers["x-opencode-workspace"] = c.workspace
	}

	c.Global = &GlobalClient{c}
	c.Project = &ProjectClient{c}
	c.Pty = &PtyClient{c}
	c.Config = &ConfigClient{c}
	c.Tool = &ToolClient{c}
	c.Instance = &InstanceClient{c}
	c.Path = &PathClient{c}
	c.VCS = &VCSClient{c}
	c.Session = &SessionClient{c}
	c.API = &APIClient{c}
	c.Command = &CommandClient{c}
	c.Provider = &ProviderClient{c}
	c.Find = &FindClient{c}
	c.File = &FileClient{c}
	c.App = &AppClient{c}
	c.MCP = &MCPClient{c}
	c.LSP = &LSPClient{c}
	c.Formatter = &FormatterClient{c}
	c.TUI = &TUIClient{c}
	c.Auth = &AuthClient{c}
	c.Event = &EventClient{c}
	c.Experimental = &ExperimentalClient{c}
	c.Permission = &PermissionClient{c}
	c.Question = &QuestionClient{c}
	c.Sync = &SyncClient{c}
	c.Skill = &SkillClient{c}
	c.Agent = &AgentClient{c}

	return c
}

// do performs an HTTP request and unmarshals the response into v.
func (c *Client) do(ctx context.Context, method, path string, opts *RequestOptions, v interface{}) (*http.Response, error) {
	reqURL := c.baseURL + path

	if opts == nil {
		opts = &RequestOptions{}
	}
	if opts.Query == nil {
		opts.Query = map[string]string{}
	}

	// Inject directory/workspace into query params for GET/HEAD
	if method == http.MethodGet || method == http.MethodHead {
		if _, ok := opts.Query["directory"]; !ok && c.directory != "" {
			opts.Query["directory"] = c.directory
		}
		if _, ok := opts.Query["workspace"]; !ok && c.workspace != "" {
			opts.Query["workspace"] = c.workspace
		}
	}

	if len(opts.Query) > 0 {
		q := url.Values{}
		for k, vv := range opts.Query {
			q.Set(k, vv)
		}
		reqURL += "?" + q.Encode()
	}

	var body io.Reader
	if opts.Body != nil {
		data, err := json.Marshal(opts.Body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		body = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}

	if resp.StatusCode >= 400 {
		var errBody map[string]interface{}
		if resp.Body != nil {
			json.NewDecoder(resp.Body).Decode(&errBody)
			resp.Body.Close()
		}
		return resp, fmt.Errorf("opencode server %s %s → %d: %v", method, path, resp.StatusCode, errBody)
	}

	if v != nil && resp.Body != nil {
		if err := json.NewDecoder(resp.Body).Decode(v); err != nil && err != io.EOF {
			resp.Body.Close()
			return resp, fmt.Errorf("decode response: %w", err)
		}
		resp.Body.Close()
	}

	return resp, nil
}

// doSSE performs an SSE request and calls handler for each event.
func (c *Client) doSSE(ctx context.Context, path string, handler func(SSEEvent) error) error {
	reqURL := c.baseURL + path

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("create SSE request: %w", err)
	}

	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("do SSE request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("SSE request failed with status %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	var event SSEEvent
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if event.Event != "" || len(event.Data) > 0 {
				if err := handler(event); err != nil {
					return err
				}
				event = SSEEvent{}
			}
			continue
		}
		if strings.HasPrefix(line, "event:") {
			event.Event = strings.TrimSpace(line[6:])
		} else if strings.HasPrefix(line, "data:") {
			if len(event.Data) > 0 {
				event.Data = append(event.Data, '\n')
			}
			event.Data = append(event.Data, []byte(strings.TrimSpace(line[5:]))...)
		} else if strings.HasPrefix(line, "id:") {
			event.ID = strings.TrimSpace(line[3:])
		} else if strings.HasPrefix(line, "retry:") {
			fmt.Sscanf(line[6:], "%d", &event.Retry)
		}
	}

	return scanner.Err()
}

// ---------------------------------------------------------------------------
// GlobalClient
// ---------------------------------------------------------------------------

type GlobalClient struct{ c *Client }

func (g *GlobalClient) Event(ctx context.Context, handler func(SSEEvent) error) error {
	return g.c.doSSE(ctx, "/global/event", handler)
}

func (g *GlobalClient) Health(ctx context.Context) (*HealthResponse, error) {
	var v HealthResponse
	_, err := g.c.do(ctx, http.MethodGet, "/global/health", nil, &v)
	return &v, err
}

func (g *GlobalClient) Config(ctx context.Context) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := g.c.do(ctx, http.MethodGet, "/global/config", nil, &v)
	return v, err
}

func (g *GlobalClient) Dispose(ctx context.Context) error {
	_, err := g.c.do(ctx, http.MethodPost, "/global/dispose", nil, nil)
	return err
}

func (g *GlobalClient) Upgrade(ctx context.Context) error {
	_, err := g.c.do(ctx, http.MethodPost, "/global/upgrade", nil, nil)
	return err
}

// ---------------------------------------------------------------------------
// ProjectClient
// ---------------------------------------------------------------------------

type ProjectClient struct{ c *Client }

func (p *ProjectClient) List(ctx context.Context) ([]ProjectInfo, error) {
	var v []ProjectInfo
	_, err := p.c.do(ctx, http.MethodGet, "/project", nil, &v)
	return v, err
}

func (p *ProjectClient) Current(ctx context.Context) (*ProjectInfo, error) {
	var v ProjectInfo
	_, err := p.c.do(ctx, http.MethodGet, "/project/current", nil, &v)
	return &v, err
}

func (p *ProjectClient) InitGit(ctx context.Context, projectID string) error {
	_, err := p.c.do(ctx, http.MethodPost, "/project/git/init", &RequestOptions{
		Body: map[string]string{"projectID": projectID},
	}, nil)
	return err
}

func (p *ProjectClient) Get(ctx context.Context, projectID string) (*ProjectInfo, error) {
	var v ProjectInfo
	_, err := p.c.do(ctx, http.MethodGet, "/project/"+projectID, nil, &v)
	return &v, err
}

// ---------------------------------------------------------------------------
// PtyClient
// ---------------------------------------------------------------------------

type PtyClient struct{ c *Client }

func (p *PtyClient) List(ctx context.Context) ([]PtyInfo, error) {
	var v []PtyInfo
	_, err := p.c.do(ctx, http.MethodGet, "/pty", nil, &v)
	return v, err
}

func (p *PtyClient) Create(ctx context.Context, body PtyCreateInput) (*PtyInfo, error) {
	var v PtyInfo
	_, err := p.c.do(ctx, http.MethodPost, "/pty", &RequestOptions{Body: body}, &v)
	return &v, err
}

func (p *PtyClient) Get(ctx context.Context, id string) (*PtyInfo, error) {
	var v PtyInfo
	_, err := p.c.do(ctx, http.MethodGet, "/pty/"+id, nil, &v)
	return &v, err
}

func (p *PtyClient) Remove(ctx context.Context, id string) error {
	_, err := p.c.do(ctx, http.MethodDelete, "/pty/"+id, nil, nil)
	return err
}

func (p *PtyClient) Update(ctx context.Context, id string, body interface{}) (*PtyInfo, error) {
	var v PtyInfo
	_, err := p.c.do(ctx, http.MethodPut, "/pty/"+id, &RequestOptions{Body: body}, &v)
	return &v, err
}

func (p *PtyClient) Connect(ctx context.Context, id string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := p.c.do(ctx, http.MethodGet, "/pty/"+id+"/connect", nil, &v)
	return v, err
}

func (p *PtyClient) ConnectToken(ctx context.Context, id string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := p.c.do(ctx, http.MethodPost, "/pty/"+id+"/connect-token", nil, &v)
	return v, err
}

func (p *PtyClient) Shells(ctx context.Context) ([]PtyShellInfo, error) {
	var v []PtyShellInfo
	_, err := p.c.do(ctx, http.MethodGet, "/pty/shells", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// ConfigClient
// ---------------------------------------------------------------------------

type ConfigClient struct{ c *Client }

func (cl *ConfigClient) Get(ctx context.Context) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := cl.c.do(ctx, http.MethodGet, "/config", nil, &v)
	return v, err
}

func (cl *ConfigClient) Update(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := cl.c.do(ctx, http.MethodPatch, "/config", &RequestOptions{Body: body}, &v)
	return v, err
}

func (cl *ConfigClient) Providers(ctx context.Context) ([]ProviderInfo, error) {
	var v []ProviderInfo
	_, err := cl.c.do(ctx, http.MethodGet, "/config/providers", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// ToolClient
// ---------------------------------------------------------------------------

type ToolClient struct{ c *Client }

func (t *ToolClient) IDs(ctx context.Context) ([]string, error) {
	var v []string
	_, err := t.c.do(ctx, http.MethodGet, "/experimental/tool/ids", nil, &v)
	return v, err
}

func (t *ToolClient) List(ctx context.Context) ([]ToolInfo, error) {
	var v []ToolInfo
	_, err := t.c.do(ctx, http.MethodGet, "/experimental/tool", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// InstanceClient
// ---------------------------------------------------------------------------

type InstanceClient struct{ c *Client }

func (i *InstanceClient) Dispose(ctx context.Context, directory string) error {
	_, err := i.c.do(ctx, http.MethodPost, "/instance/dispose", &RequestOptions{
		Body: map[string]string{"directory": directory},
	}, nil)
	return err
}

// ---------------------------------------------------------------------------
// PathClient
// ---------------------------------------------------------------------------

type PathClient struct{ c *Client }

func (p *PathClient) Get(ctx context.Context) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := p.c.do(ctx, http.MethodGet, "/path", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// VCSClient
// ---------------------------------------------------------------------------

type VCSClient struct{ c *Client }

func (v *VCSClient) Get(ctx context.Context) (map[string]interface{}, error) {
	var m map[string]interface{}
	_, err := v.c.do(ctx, http.MethodGet, "/vcs", nil, &m)
	return m, err
}

func (v *VCSClient) Diff(ctx context.Context, query map[string]string) ([]FileDiff, error) {
	var diffs []FileDiff
	_, err := v.c.do(ctx, http.MethodGet, "/vcs/diff", &RequestOptions{Query: query}, &diffs)
	return diffs, err
}

// ---------------------------------------------------------------------------
// SessionClient
// ---------------------------------------------------------------------------

type SessionClient struct{ c *Client }

func (s *SessionClient) List(ctx context.Context) ([]SessionInfo, error) {
	var v []SessionInfo
	_, err := s.c.do(ctx, http.MethodGet, "/session", nil, &v)
	return v, err
}

func (s *SessionClient) Create(ctx context.Context, body SessionCreateInput) (*SessionInfo, error) {
	var v SessionInfo
	_, err := s.c.do(ctx, http.MethodPost, "/session", &RequestOptions{Body: body}, &v)
	return &v, err
}

func (s *SessionClient) Get(ctx context.Context, id string) (*SessionInfo, error) {
	var v SessionInfo
	_, err := s.c.do(ctx, http.MethodGet, "/session/"+id, nil, &v)
	return &v, err
}

func (s *SessionClient) Update(ctx context.Context, id string, body SessionUpdateInput) (*SessionInfo, error) {
	var v SessionInfo
	_, err := s.c.do(ctx, http.MethodPatch, "/session/"+id, &RequestOptions{Body: body}, &v)
	return &v, err
}

func (s *SessionClient) Delete(ctx context.Context, id string) error {
	_, err := s.c.do(ctx, http.MethodDelete, "/session/"+id, nil, nil)
	return err
}

func (s *SessionClient) Status(ctx context.Context) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := s.c.do(ctx, http.MethodGet, "/session/status", nil, &v)
	return v, err
}

func (s *SessionClient) Children(ctx context.Context, id string) ([]SessionInfo, error) {
	var v []SessionInfo
	_, err := s.c.do(ctx, http.MethodGet, "/session/"+id+"/children", nil, &v)
	return v, err
}

func (s *SessionClient) Todo(ctx context.Context, id string) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := s.c.do(ctx, http.MethodGet, "/session/"+id+"/todo", nil, &v)
	return v, err
}

func (s *SessionClient) Fork(ctx context.Context, id string) (*SessionInfo, error) {
	var v SessionInfo
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/fork", nil, &v)
	return &v, err
}

func (s *SessionClient) Abort(ctx context.Context, id string) error {
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/abort", nil, nil)
	return err
}

func (s *SessionClient) Init(ctx context.Context, id string) error {
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/init", nil, nil)
	return err
}

func (s *SessionClient) Summarize(ctx context.Context, id string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/summarize", nil, &v)
	return v, err
}

func (s *SessionClient) Messages(ctx context.Context, id string) ([]Message, error) {
	var v []Message
	_, err := s.c.do(ctx, http.MethodGet, "/session/"+id+"/message", nil, &v)
	return v, err
}

func (s *SessionClient) Message(ctx context.Context, sessionID, messageID string) (*Message, error) {
	var v Message
	_, err := s.c.do(ctx, http.MethodGet, "/session/"+sessionID+"/message/"+messageID, nil, &v)
	return &v, err
}

func (s *SessionClient) Prompt(ctx context.Context, id string, body PromptInput) (*Message, error) {
	var v Message
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/message", &RequestOptions{Body: body}, &v)
	return &v, err
}

func (s *SessionClient) PromptAsync(ctx context.Context, id string, body PromptInput) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/prompt_async", &RequestOptions{Body: body}, &v)
	return v, err
}

func (s *SessionClient) Command(ctx context.Context, id string, body CommandInput) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/command", &RequestOptions{Body: body}, &v)
	return v, err
}

func (s *SessionClient) Shell(ctx context.Context, id string, body ShellInput) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/shell", &RequestOptions{Body: body}, &v)
	return v, err
}

func (s *SessionClient) DeleteMessage(ctx context.Context, sessionID, messageID string) error {
	_, err := s.c.do(ctx, http.MethodDelete, "/session/"+sessionID+"/message/"+messageID, nil, nil)
	return err
}

func (s *SessionClient) DeletePart(ctx context.Context, sessionID, messageID, partID string) error {
	_, err := s.c.do(ctx, http.MethodDelete, "/session/"+sessionID+"/message/"+messageID+"/part/"+partID, nil, nil)
	return err
}

func (s *SessionClient) Diff(ctx context.Context, id string) ([]FileDiff, error) {
	var v []FileDiff
	_, err := s.c.do(ctx, http.MethodGet, "/session/"+id+"/diff", nil, &v)
	return v, err
}

func (s *SessionClient) Revert(ctx context.Context, id string) error {
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/revert", nil, nil)
	return err
}

func (s *SessionClient) Unrevert(ctx context.Context, id string) error {
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/unrevert", nil, nil)
	return err
}

func (s *SessionClient) Share(ctx context.Context, id string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/share", nil, &v)
	return v, err
}

func (s *SessionClient) Unshare(ctx context.Context, id string) error {
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+id+"/unshare", nil, nil)
	return err
}

func (s *SessionClient) Permissions(ctx context.Context, sessionID, permissionID string, body interface{}) error {
	_, err := s.c.do(ctx, http.MethodPost, "/session/"+sessionID+"/permissions/"+permissionID, &RequestOptions{Body: body}, nil)
	return err
}

// ---------------------------------------------------------------------------
// APIClient — v2 API endpoints (/api/session)
// ---------------------------------------------------------------------------

type APIClient struct{ c *Client }

func (a *APIClient) SessionList(ctx context.Context) ([]SessionInfo, error) {
	var v []SessionInfo
	_, err := a.c.do(ctx, http.MethodGet, "/api/session", nil, &v)
	return v, err
}

func (a *APIClient) SessionCreate(ctx context.Context, body interface{}) (*SessionInfo, error) {
	var v SessionInfo
	_, err := a.c.do(ctx, http.MethodPost, "/api/session", &RequestOptions{Body: body}, &v)
	return &v, err
}

func (a *APIClient) SessionPrompt(ctx context.Context, sessionID string, body interface{}) (*Message, error) {
	var v Message
	_, err := a.c.do(ctx, http.MethodPost, "/api/session/"+sessionID+"/prompt", &RequestOptions{Body: body}, &v)
	return &v, err
}

func (a *APIClient) SessionCompact(ctx context.Context, sessionID string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := a.c.do(ctx, http.MethodPost, "/api/session/"+sessionID+"/compact", nil, &v)
	return v, err
}

func (a *APIClient) SessionWait(ctx context.Context, sessionID string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := a.c.do(ctx, http.MethodPost, "/api/session/"+sessionID+"/wait", nil, &v)
	return v, err
}

func (a *APIClient) SessionContext(ctx context.Context, sessionID string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := a.c.do(ctx, http.MethodGet, "/api/session/"+sessionID+"/context", nil, &v)
	return v, err
}

func (a *APIClient) SessionMessages(ctx context.Context, sessionID string) ([]Message, error) {
	var v []Message
	_, err := a.c.do(ctx, http.MethodGet, "/api/session/"+sessionID+"/message", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// CommandClient
// ---------------------------------------------------------------------------

type CommandClient struct{ c *Client }

func (cmd *CommandClient) List(ctx context.Context) ([]CommandInfo, error) {
	var v []CommandInfo
	_, err := cmd.c.do(ctx, http.MethodGet, "/command", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// ProviderClient
// ---------------------------------------------------------------------------

type ProviderClient struct{ c *Client }

func (p *ProviderClient) List(ctx context.Context) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := p.c.do(ctx, http.MethodGet, "/provider", nil, &v)
	return v, err
}

func (p *ProviderClient) Auth(ctx context.Context, body interface{}) error {
	_, err := p.c.do(ctx, http.MethodPost, "/provider/auth", &RequestOptions{Body: body}, nil)
	return err
}

func (p *ProviderClient) OAuthAuthorize(ctx context.Context, providerID string) (*ProviderAuthResponse, error) {
	var v ProviderAuthResponse
	_, err := p.c.do(ctx, http.MethodPost, "/provider/"+providerID+"/oauth/authorize", nil, &v)
	return &v, err
}

func (p *ProviderClient) OAuthCallback(ctx context.Context, providerID string, body interface{}) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := p.c.do(ctx, http.MethodPost, "/provider/"+providerID+"/oauth/callback", &RequestOptions{Body: body}, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// FindClient
// ---------------------------------------------------------------------------

type FindClient struct{ c *Client }

func (f *FindClient) Text(ctx context.Context, query string) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := f.c.do(ctx, http.MethodGet, "/find", &RequestOptions{
		Query: map[string]string{"query": query},
	}, &v)
	return v, err
}

func (f *FindClient) Files(ctx context.Context, query string) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := f.c.do(ctx, http.MethodGet, "/find/file", &RequestOptions{
		Query: map[string]string{"query": query},
	}, &v)
	return v, err
}

func (f *FindClient) Symbols(ctx context.Context, query string) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := f.c.do(ctx, http.MethodGet, "/find/symbol", &RequestOptions{
		Query: map[string]string{"query": query},
	}, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// FileClient
// ---------------------------------------------------------------------------

type FileClient struct{ c *Client }

func (f *FileClient) List(ctx context.Context, query map[string]string) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := f.c.do(ctx, http.MethodGet, "/file", &RequestOptions{Query: query}, &v)
	return v, err
}

func (f *FileClient) Read(ctx context.Context, path string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := f.c.do(ctx, http.MethodGet, "/file/content", &RequestOptions{
		Query: map[string]string{"path": path},
	}, &v)
	return v, err
}

func (f *FileClient) Status(ctx context.Context, path string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := f.c.do(ctx, http.MethodGet, "/file/status", &RequestOptions{
		Query: map[string]string{"path": path},
	}, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// AppClient
// ---------------------------------------------------------------------------

type AppClient struct{ c *Client }

func (a *AppClient) Log(ctx context.Context) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := a.c.do(ctx, http.MethodGet, "/log", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// AgentClient
// ---------------------------------------------------------------------------

type AgentClient struct{ c *Client }

func (a *AgentClient) List(ctx context.Context) ([]AgentInfo, error) {
	var v []AgentInfo
	_, err := a.c.do(ctx, http.MethodGet, "/agent", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// MCPClient
// ---------------------------------------------------------------------------

type MCPClient struct{ c *Client }

func (m *MCPClient) Status(ctx context.Context) (*MCPStatusResponse, error) {
	var v MCPStatusResponse
	_, err := m.c.do(ctx, http.MethodGet, "/mcp", nil, &v)
	return &v, err
}

func (m *MCPClient) Connect(ctx context.Context, name string) error {
	_, err := m.c.do(ctx, http.MethodPost, "/mcp/"+name+"/connect", nil, nil)
	return err
}

func (m *MCPClient) Disconnect(ctx context.Context, name string) error {
	_, err := m.c.do(ctx, http.MethodPost, "/mcp/"+name+"/disconnect", nil, nil)
	return err
}

func (m *MCPClient) AuthStart(ctx context.Context, name string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := m.c.do(ctx, http.MethodPost, "/mcp/"+name+"/auth", nil, &v)
	return v, err
}

func (m *MCPClient) AuthCallback(ctx context.Context, name string, body interface{}) error {
	_, err := m.c.do(ctx, http.MethodPost, "/mcp/"+name+"/auth/callback", &RequestOptions{Body: body}, nil)
	return err
}

func (m *MCPClient) AuthAuthenticate(ctx context.Context, name string, body interface{}) error {
	_, err := m.c.do(ctx, http.MethodPost, "/mcp/"+name+"/auth/authenticate", &RequestOptions{Body: body}, nil)
	return err
}

func (m *MCPClient) AuthRemove(ctx context.Context, name string) error {
	_, err := m.c.do(ctx, http.MethodDelete, "/mcp/"+name+"/auth", nil, nil)
	return err
}

// ---------------------------------------------------------------------------
// LSPClient
// ---------------------------------------------------------------------------

type LSPClient struct{ c *Client }

func (l *LSPClient) Status(ctx context.Context) ([]LSPServerInfo, error) {
	var v []LSPServerInfo
	_, err := l.c.do(ctx, http.MethodGet, "/lsp", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// FormatterClient
// ---------------------------------------------------------------------------

type FormatterClient struct{ c *Client }

func (f *FormatterClient) Status(ctx context.Context) ([]string, error) {
	var v []string
	_, err := f.c.do(ctx, http.MethodGet, "/formatter", nil, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// TUIClient
// ---------------------------------------------------------------------------

type TUIClient struct{ c *Client }

func (t *TUIClient) AppendPrompt(ctx context.Context, text string) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/append-prompt", &RequestOptions{
		Body: map[string]string{"text": text},
	}, nil)
	return err
}

func (t *TUIClient) SubmitPrompt(ctx context.Context) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/submit-prompt", nil, nil)
	return err
}

func (t *TUIClient) ClearPrompt(ctx context.Context) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/clear-prompt", nil, nil)
	return err
}

func (t *TUIClient) ExecuteCommand(ctx context.Context, body TuiExecuteCommandInput) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/execute-command", &RequestOptions{
		Body: body,
	}, nil)
	return err
}

func (t *TUIClient) ShowToast(ctx context.Context, body TuiShowToastInput) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/show-toast", &RequestOptions{Body: body}, nil)
	return err
}

func (t *TUIClient) Publish(ctx context.Context, body interface{}) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/publish", &RequestOptions{Body: body}, nil)
	return err
}

func (t *TUIClient) OpenHelp(ctx context.Context) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/open-help", nil, nil)
	return err
}

func (t *TUIClient) OpenSessions(ctx context.Context) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/open-sessions", nil, nil)
	return err
}

func (t *TUIClient) OpenThemes(ctx context.Context) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/open-themes", nil, nil)
	return err
}

func (t *TUIClient) OpenModels(ctx context.Context) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/open-models", nil, nil)
	return err
}

func (t *TUIClient) SelectSession(ctx context.Context, body interface{}) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/select-session", &RequestOptions{Body: body}, nil)
	return err
}

func (t *TUIClient) ControlNext(ctx context.Context) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/control/next", nil, nil)
	return err
}

func (t *TUIClient) ControlResponse(ctx context.Context, body interface{}) error {
	_, err := t.c.do(ctx, http.MethodPost, "/tui/control/response", &RequestOptions{Body: body}, nil)
	return err
}

// ---------------------------------------------------------------------------
// AuthClient
// ---------------------------------------------------------------------------

type AuthClient struct{ c *Client }

func (a *AuthClient) Set(ctx context.Context, providerID string, body interface{}) error {
	_, err := a.c.do(ctx, http.MethodPut, "/auth/"+providerID, &RequestOptions{Body: body}, nil)
	return err
}

func (a *AuthClient) Remove(ctx context.Context, providerID string) error {
	_, err := a.c.do(ctx, http.MethodDelete, "/auth/"+providerID, nil, nil)
	return err
}

// ---------------------------------------------------------------------------
// EventClient
// ---------------------------------------------------------------------------

type EventClient struct{ c *Client }

func (e *EventClient) Subscribe(ctx context.Context, handler func(SSEEvent) error) error {
	return e.c.doSSE(ctx, "/event", handler)
}

// ---------------------------------------------------------------------------
// ExperimentalClient
// ---------------------------------------------------------------------------

type ExperimentalClient struct{ c *Client }

func (x *ExperimentalClient) Console(ctx context.Context) (*ConsoleInfo, error) {
	var v ConsoleInfo
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/console", nil, &v)
	return &v, err
}

func (x *ExperimentalClient) ConsoleOrgs(ctx context.Context) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/console/orgs", nil, &v)
	return v, err
}

func (x *ExperimentalClient) ConsoleSwitch(ctx context.Context, body interface{}) error {
	_, err := x.c.do(ctx, http.MethodPost, "/experimental/console/switch", &RequestOptions{Body: body}, nil)
	return err
}

func (x *ExperimentalClient) ResourceList(ctx context.Context) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/resource", nil, &v)
	return v, err
}

func (x *ExperimentalClient) SessionList(ctx context.Context) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/session", nil, &v)
	return v, err
}

func (x *ExperimentalClient) SessionCreate(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := x.c.do(ctx, http.MethodPost, "/experimental/session", &RequestOptions{Body: body}, &v)
	return v, err
}

func (x *ExperimentalClient) WorkspaceList(ctx context.Context) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/workspace", nil, &v)
	return v, err
}

func (x *ExperimentalClient) WorkspaceCreate(ctx context.Context, body WorkspaceCreateInput) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := x.c.do(ctx, http.MethodPost, "/experimental/workspace", &RequestOptions{Body: body}, &v)
	return v, err
}

func (x *ExperimentalClient) WorkspaceGet(ctx context.Context, id string) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/workspace/"+id, nil, &v)
	return v, err
}

func (x *ExperimentalClient) WorkspaceRemove(ctx context.Context, id string) error {
	_, err := x.c.do(ctx, http.MethodDelete, "/experimental/workspace/"+id, nil, nil)
	return err
}

func (x *ExperimentalClient) WorkspaceStatus(ctx context.Context) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/workspace/status", nil, &v)
	return v, err
}

func (x *ExperimentalClient) WorkspaceAdapter(ctx context.Context) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/workspace/adapter", nil, &v)
	return v, err
}

func (x *ExperimentalClient) WorkspaceWarp(ctx context.Context, id string) error {
	_, err := x.c.do(ctx, http.MethodPost, "/experimental/workspace/warp", nil, nil)
	return err
}

func (x *ExperimentalClient) WorktreeList(ctx context.Context) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := x.c.do(ctx, http.MethodGet, "/experimental/worktree", nil, &v)
	return v, err
}

func (x *ExperimentalClient) WorktreeCreate(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := x.c.do(ctx, http.MethodPost, "/experimental/worktree", &RequestOptions{Body: body}, &v)
	return v, err
}

func (x *ExperimentalClient) WorktreeRemove(ctx context.Context) error {
	_, err := x.c.do(ctx, http.MethodDelete, "/experimental/worktree", nil, nil)
	return err
}

func (x *ExperimentalClient) WorktreeReset(ctx context.Context) error {
	_, err := x.c.do(ctx, http.MethodPost, "/experimental/worktree/reset", nil, nil)
	return err
}

// ---------------------------------------------------------------------------
// PermissionClient
// ---------------------------------------------------------------------------

type PermissionClient struct{ c *Client }

func (p *PermissionClient) List(ctx context.Context) ([]PermissionInfo, error) {
	var v []PermissionInfo
	_, err := p.c.do(ctx, http.MethodGet, "/permission", nil, &v)
	return v, err
}

func (p *PermissionClient) Reply(ctx context.Context, requestID string, body PermissionReplyInput) error {
	_, err := p.c.do(ctx, http.MethodPost, "/permission/"+requestID+"/reply", &RequestOptions{Body: body}, nil)
	return err
}

// ---------------------------------------------------------------------------
// QuestionClient
// ---------------------------------------------------------------------------

type QuestionClient struct{ c *Client }

func (q *QuestionClient) Reply(ctx context.Context, requestID string, body QuestionReplyInput) error {
	_, err := q.c.do(ctx, http.MethodPost, "/question/"+requestID+"/reply", &RequestOptions{Body: body}, nil)
	return err
}

func (q *QuestionClient) Reject(ctx context.Context, requestID string) error {
	_, err := q.c.do(ctx, http.MethodPost, "/question/"+requestID+"/reject", nil, nil)
	return err
}

// ---------------------------------------------------------------------------
// SyncClient
// ---------------------------------------------------------------------------

type SyncClient struct{ c *Client }

func (s *SyncClient) Start(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/sync/start", &RequestOptions{Body: body}, &v)
	return v, err
}

func (s *SyncClient) Replay(ctx context.Context, body SyncReplayInput) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/sync/replay", &RequestOptions{Body: body}, &v)
	return v, err
}

func (s *SyncClient) Steal(ctx context.Context, body SyncStealInput) (map[string]interface{}, error) {
	var v map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/sync/steal", &RequestOptions{Body: body}, &v)
	return v, err
}

func (s *SyncClient) History(ctx context.Context, body interface{}) ([]map[string]interface{}, error) {
	var v []map[string]interface{}
	_, err := s.c.do(ctx, http.MethodPost, "/sync/history", &RequestOptions{Body: body}, &v)
	return v, err
}

// ---------------------------------------------------------------------------
// SkillClient
// ---------------------------------------------------------------------------

type SkillClient struct{ c *Client }

func (s *SkillClient) List(ctx context.Context) ([]SkillInfo, error) {
	var v []SkillInfo
	_, err := s.c.do(ctx, http.MethodGet, "/skill", nil, &v)
	return v, err
}
