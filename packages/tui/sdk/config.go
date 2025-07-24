// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"net/http"
	"reflect"

	"github.com/sst/opencode-sdk-go/internal/apijson"
	"github.com/sst/opencode-sdk-go/internal/requestconfig"
	"github.com/sst/opencode-sdk-go/option"
	"github.com/tidwall/gjson"
)

// ConfigService contains methods and other services that help with interacting
// with the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewConfigService] method instead.
type ConfigService struct {
	Options []option.RequestOption
}

// NewConfigService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewConfigService(opts ...option.RequestOption) (r *ConfigService) {
	r = &ConfigService{}
	r.Options = opts
	return
}

// Get config info
func (r *ConfigService) Get(ctx context.Context, opts ...option.RequestOption) (res *Config, err error) {
	opts = append(r.Options[:], opts...)
	path := "config"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, nil, &res, opts...)
	return
}

type Config struct {
	// JSON schema reference for configuration validation
	Schema string `json:"$schema"`
	// @deprecated Use 'share' field instead. Share newly created sessions
	// automatically
	Autoshare bool `json:"autoshare"`
	// Automatically update to the latest version
	Autoupdate bool `json:"autoupdate"`
	// Disable providers that are loaded automatically
	DisabledProviders []string           `json:"disabled_providers"`
	Experimental      ConfigExperimental `json:"experimental"`
	// Additional instruction files or patterns to include
	Instructions []string `json:"instructions"`
	// Custom keybind configurations
	Keybinds KeybindsConfig `json:"keybinds"`
	// @deprecated Always uses stretch layout.
	Layout ConfigLayout `json:"layout"`
	// MCP (Model Context Protocol) server configurations
	Mcp map[string]ConfigMcp `json:"mcp"`
	// Modes configuration, see https://opencode.ai/docs/modes
	Mode ConfigMode `json:"mode"`
	// Model to use in the format of provider/model, eg anthropic/claude-2
	Model string `json:"model"`
	// Custom provider configurations and model overrides
	Provider map[string]ConfigProvider `json:"provider"`
	// Control sharing behavior:'manual' allows manual sharing via commands, 'auto'
	// enables automatic sharing, 'disabled' disables all sharing
	Share ConfigShare `json:"share"`
	// Small model to use for tasks like summarization and title generation in the
	// format of provider/model
	SmallModel string `json:"small_model"`
	// Theme name to use for the interface
	Theme string `json:"theme"`
	// Custom username to display in conversations instead of system username
	Username string     `json:"username"`
	JSON     configJSON `json:"-"`
}

// configJSON contains the JSON metadata for the struct [Config]
type configJSON struct {
	Schema            apijson.Field
	Autoshare         apijson.Field
	Autoupdate        apijson.Field
	DisabledProviders apijson.Field
	Experimental      apijson.Field
	Instructions      apijson.Field
	Keybinds          apijson.Field
	Layout            apijson.Field
	Mcp               apijson.Field
	Mode              apijson.Field
	Model             apijson.Field
	Provider          apijson.Field
	Share             apijson.Field
	SmallModel        apijson.Field
	Theme             apijson.Field
	Username          apijson.Field
	raw               string
	ExtraFields       map[string]apijson.Field
}

func (r *Config) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configJSON) RawJSON() string {
	return r.raw
}

type ConfigExperimental struct {
	Hook ConfigExperimentalHook `json:"hook"`
	JSON configExperimentalJSON `json:"-"`
}

// configExperimentalJSON contains the JSON metadata for the struct
// [ConfigExperimental]
type configExperimentalJSON struct {
	Hook        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigExperimental) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configExperimentalJSON) RawJSON() string {
	return r.raw
}

type ConfigExperimentalHook struct {
	FileEdited       map[string][]ConfigExperimentalHookFileEdited `json:"file_edited"`
	SessionCompleted []ConfigExperimentalHookSessionCompleted      `json:"session_completed"`
	JSON             configExperimentalHookJSON                    `json:"-"`
}

// configExperimentalHookJSON contains the JSON metadata for the struct
// [ConfigExperimentalHook]
type configExperimentalHookJSON struct {
	FileEdited       apijson.Field
	SessionCompleted apijson.Field
	raw              string
	ExtraFields      map[string]apijson.Field
}

func (r *ConfigExperimentalHook) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configExperimentalHookJSON) RawJSON() string {
	return r.raw
}

type ConfigExperimentalHookFileEdited struct {
	Command     []string                             `json:"command,required"`
	Environment map[string]string                    `json:"environment"`
	JSON        configExperimentalHookFileEditedJSON `json:"-"`
}

// configExperimentalHookFileEditedJSON contains the JSON metadata for the struct
// [ConfigExperimentalHookFileEdited]
type configExperimentalHookFileEditedJSON struct {
	Command     apijson.Field
	Environment apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigExperimentalHookFileEdited) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configExperimentalHookFileEditedJSON) RawJSON() string {
	return r.raw
}

type ConfigExperimentalHookSessionCompleted struct {
	Command     []string                                   `json:"command,required"`
	Environment map[string]string                          `json:"environment"`
	JSON        configExperimentalHookSessionCompletedJSON `json:"-"`
}

// configExperimentalHookSessionCompletedJSON contains the JSON metadata for the
// struct [ConfigExperimentalHookSessionCompleted]
type configExperimentalHookSessionCompletedJSON struct {
	Command     apijson.Field
	Environment apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigExperimentalHookSessionCompleted) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configExperimentalHookSessionCompletedJSON) RawJSON() string {
	return r.raw
}

// @deprecated Always uses stretch layout.
type ConfigLayout string

const (
	ConfigLayoutAuto    ConfigLayout = "auto"
	ConfigLayoutStretch ConfigLayout = "stretch"
)

func (r ConfigLayout) IsKnown() bool {
	switch r {
	case ConfigLayoutAuto, ConfigLayoutStretch:
		return true
	}
	return false
}

type ConfigMcp struct {
	// Type of MCP server connection
	Type ConfigMcpType `json:"type,required"`
	// This field can have the runtime type of [[]string].
	Command interface{} `json:"command"`
	// Enable or disable the MCP server on startup
	Enabled bool `json:"enabled"`
	// This field can have the runtime type of [map[string]string].
	Environment interface{} `json:"environment"`
	// This field can have the runtime type of [map[string]string].
	Headers interface{} `json:"headers"`
	// URL of the remote MCP server
	URL   string        `json:"url"`
	JSON  configMcpJSON `json:"-"`
	union ConfigMcpUnion
}

// configMcpJSON contains the JSON metadata for the struct [ConfigMcp]
type configMcpJSON struct {
	Type        apijson.Field
	Command     apijson.Field
	Enabled     apijson.Field
	Environment apijson.Field
	Headers     apijson.Field
	URL         apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r configMcpJSON) RawJSON() string {
	return r.raw
}

func (r *ConfigMcp) UnmarshalJSON(data []byte) (err error) {
	*r = ConfigMcp{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [ConfigMcpUnion] interface which you can cast to the specific
// types for more type safety.
//
// Possible runtime types of the union are [McpLocalConfig], [McpRemoteConfig].
func (r ConfigMcp) AsUnion() ConfigMcpUnion {
	return r.union
}

// Union satisfied by [McpLocalConfig] or [McpRemoteConfig].
type ConfigMcpUnion interface {
	implementsConfigMcp()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*ConfigMcpUnion)(nil)).Elem(),
		"type",
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(McpLocalConfig{}),
			DiscriminatorValue: "local",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(McpRemoteConfig{}),
			DiscriminatorValue: "remote",
		},
	)
}

// Type of MCP server connection
type ConfigMcpType string

const (
	ConfigMcpTypeLocal  ConfigMcpType = "local"
	ConfigMcpTypeRemote ConfigMcpType = "remote"
)

func (r ConfigMcpType) IsKnown() bool {
	switch r {
	case ConfigMcpTypeLocal, ConfigMcpTypeRemote:
		return true
	}
	return false
}

// Modes configuration, see https://opencode.ai/docs/modes
type ConfigMode struct {
	Build       ModeConfig            `json:"build"`
	Plan        ModeConfig            `json:"plan"`
	ExtraFields map[string]ModeConfig `json:"-,extras"`
	JSON        configModeJSON        `json:"-"`
}

// configModeJSON contains the JSON metadata for the struct [ConfigMode]
type configModeJSON struct {
	Build       apijson.Field
	Plan        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigMode) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configModeJSON) RawJSON() string {
	return r.raw
}

type ConfigProvider struct {
	Models  map[string]ConfigProviderModel `json:"models,required"`
	ID      string                         `json:"id"`
	API     string                         `json:"api"`
	Env     []string                       `json:"env"`
	Name    string                         `json:"name"`
	Npm     string                         `json:"npm"`
	Options ConfigProviderOptions          `json:"options"`
	JSON    configProviderJSON             `json:"-"`
}

// configProviderJSON contains the JSON metadata for the struct [ConfigProvider]
type configProviderJSON struct {
	Models      apijson.Field
	ID          apijson.Field
	API         apijson.Field
	Env         apijson.Field
	Name        apijson.Field
	Npm         apijson.Field
	Options     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigProvider) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configProviderJSON) RawJSON() string {
	return r.raw
}

type ConfigProviderModel struct {
	ID          string                    `json:"id"`
	Attachment  bool                      `json:"attachment"`
	Cost        ConfigProviderModelsCost  `json:"cost"`
	Limit       ConfigProviderModelsLimit `json:"limit"`
	Name        string                    `json:"name"`
	Options     map[string]interface{}    `json:"options"`
	Reasoning   bool                      `json:"reasoning"`
	ReleaseDate string                    `json:"release_date"`
	Temperature bool                      `json:"temperature"`
	ToolCall    bool                      `json:"tool_call"`
	JSON        configProviderModelJSON   `json:"-"`
}

// configProviderModelJSON contains the JSON metadata for the struct
// [ConfigProviderModel]
type configProviderModelJSON struct {
	ID          apijson.Field
	Attachment  apijson.Field
	Cost        apijson.Field
	Limit       apijson.Field
	Name        apijson.Field
	Options     apijson.Field
	Reasoning   apijson.Field
	ReleaseDate apijson.Field
	Temperature apijson.Field
	ToolCall    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigProviderModel) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configProviderModelJSON) RawJSON() string {
	return r.raw
}

type ConfigProviderModelsCost struct {
	Input      float64                      `json:"input,required"`
	Output     float64                      `json:"output,required"`
	CacheRead  float64                      `json:"cache_read"`
	CacheWrite float64                      `json:"cache_write"`
	JSON       configProviderModelsCostJSON `json:"-"`
}

// configProviderModelsCostJSON contains the JSON metadata for the struct
// [ConfigProviderModelsCost]
type configProviderModelsCostJSON struct {
	Input       apijson.Field
	Output      apijson.Field
	CacheRead   apijson.Field
	CacheWrite  apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigProviderModelsCost) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configProviderModelsCostJSON) RawJSON() string {
	return r.raw
}

type ConfigProviderModelsLimit struct {
	Context float64                       `json:"context,required"`
	Output  float64                       `json:"output,required"`
	JSON    configProviderModelsLimitJSON `json:"-"`
}

// configProviderModelsLimitJSON contains the JSON metadata for the struct
// [ConfigProviderModelsLimit]
type configProviderModelsLimitJSON struct {
	Context     apijson.Field
	Output      apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigProviderModelsLimit) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configProviderModelsLimitJSON) RawJSON() string {
	return r.raw
}

type ConfigProviderOptions struct {
	APIKey      string                    `json:"apiKey"`
	BaseURL     string                    `json:"baseURL"`
	ExtraFields map[string]interface{}    `json:"-,extras"`
	JSON        configProviderOptionsJSON `json:"-"`
}

// configProviderOptionsJSON contains the JSON metadata for the struct
// [ConfigProviderOptions]
type configProviderOptionsJSON struct {
	APIKey      apijson.Field
	BaseURL     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigProviderOptions) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configProviderOptionsJSON) RawJSON() string {
	return r.raw
}

// Control sharing behavior:'manual' allows manual sharing via commands, 'auto'
// enables automatic sharing, 'disabled' disables all sharing
type ConfigShare string

const (
	ConfigShareManual   ConfigShare = "manual"
	ConfigShareAuto     ConfigShare = "auto"
	ConfigShareDisabled ConfigShare = "disabled"
)

func (r ConfigShare) IsKnown() bool {
	switch r {
	case ConfigShareManual, ConfigShareAuto, ConfigShareDisabled:
		return true
	}
	return false
}

type KeybindsConfig struct {
	// Exit the application
	AppExit string `json:"app_exit,required"`
	// Show help dialog
	AppHelp string `json:"app_help,required"`
	// Open external editor
	EditorOpen string `json:"editor_open,required"`
	// Close file
	FileClose string `json:"file_close,required"`
	// Split/unified diff
	FileDiffToggle string `json:"file_diff_toggle,required"`
	// List files
	FileList string `json:"file_list,required"`
	// Search file
	FileSearch string `json:"file_search,required"`
	// Clear input field
	InputClear string `json:"input_clear,required"`
	// Insert newline in input
	InputNewline string `json:"input_newline,required"`
	// Paste from clipboard
	InputPaste string `json:"input_paste,required"`
	// Submit input
	InputSubmit string `json:"input_submit,required"`
	// Leader key for keybind combinations
	Leader string `json:"leader,required"`
	// Copy message
	MessagesCopy string `json:"messages_copy,required"`
	// Navigate to first message
	MessagesFirst string `json:"messages_first,required"`
	// Scroll messages down by half page
	MessagesHalfPageDown string `json:"messages_half_page_down,required"`
	// Scroll messages up by half page
	MessagesHalfPageUp string `json:"messages_half_page_up,required"`
	// Navigate to last message
	MessagesLast string `json:"messages_last,required"`
	// Toggle layout
	MessagesLayoutToggle string `json:"messages_layout_toggle,required"`
	// Navigate to next message
	MessagesNext string `json:"messages_next,required"`
	// Scroll messages down by one page
	MessagesPageDown string `json:"messages_page_down,required"`
	// Scroll messages up by one page
	MessagesPageUp string `json:"messages_page_up,required"`
	// Navigate to previous message
	MessagesPrevious string `json:"messages_previous,required"`
	// Redo message
	MessagesRedo string `json:"messages_redo,required"`
	// @deprecated use messages_undo. Revert message
	MessagesRevert string `json:"messages_revert,required"`
	// Undo message
	MessagesUndo string `json:"messages_undo,required"`
	// List available models
	ModelList string `json:"model_list,required"`
	// Create/update AGENTS.md
	ProjectInit string `json:"project_init,required"`
	// Compact the session
	SessionCompact string `json:"session_compact,required"`
	// Export session to editor
	SessionExport string `json:"session_export,required"`
	// Interrupt current session
	SessionInterrupt string `json:"session_interrupt,required"`
	// List all sessions
	SessionList string `json:"session_list,required"`
	// Create a new session
	SessionNew string `json:"session_new,required"`
	// Share current session
	SessionShare string `json:"session_share,required"`
	// Unshare current session
	SessionUnshare string `json:"session_unshare,required"`
	// Next mode
	SwitchMode string `json:"switch_mode,required"`
	// Previous Mode
	SwitchModeReverse string `json:"switch_mode_reverse,required"`
	// List available themes
	ThemeList string `json:"theme_list,required"`
	// Toggle tool details
	ToolDetails string             `json:"tool_details,required"`
	JSON        keybindsConfigJSON `json:"-"`
}

// keybindsConfigJSON contains the JSON metadata for the struct [KeybindsConfig]
type keybindsConfigJSON struct {
	AppExit              apijson.Field
	AppHelp              apijson.Field
	EditorOpen           apijson.Field
	FileClose            apijson.Field
	FileDiffToggle       apijson.Field
	FileList             apijson.Field
	FileSearch           apijson.Field
	InputClear           apijson.Field
	InputNewline         apijson.Field
	InputPaste           apijson.Field
	InputSubmit          apijson.Field
	Leader               apijson.Field
	MessagesCopy         apijson.Field
	MessagesFirst        apijson.Field
	MessagesHalfPageDown apijson.Field
	MessagesHalfPageUp   apijson.Field
	MessagesLast         apijson.Field
	MessagesLayoutToggle apijson.Field
	MessagesNext         apijson.Field
	MessagesPageDown     apijson.Field
	MessagesPageUp       apijson.Field
	MessagesPrevious     apijson.Field
	MessagesRedo         apijson.Field
	MessagesRevert       apijson.Field
	MessagesUndo         apijson.Field
	ModelList            apijson.Field
	ProjectInit          apijson.Field
	SessionCompact       apijson.Field
	SessionExport        apijson.Field
	SessionInterrupt     apijson.Field
	SessionList          apijson.Field
	SessionNew           apijson.Field
	SessionShare         apijson.Field
	SessionUnshare       apijson.Field
	SwitchMode           apijson.Field
	SwitchModeReverse    apijson.Field
	ThemeList            apijson.Field
	ToolDetails          apijson.Field
	raw                  string
	ExtraFields          map[string]apijson.Field
}

func (r *KeybindsConfig) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r keybindsConfigJSON) RawJSON() string {
	return r.raw
}

type McpLocalConfig struct {
	// Command and arguments to run the MCP server
	Command []string `json:"command,required"`
	// Type of MCP server connection
	Type McpLocalConfigType `json:"type,required"`
	// Enable or disable the MCP server on startup
	Enabled bool `json:"enabled"`
	// Environment variables to set when running the MCP server
	Environment map[string]string  `json:"environment"`
	JSON        mcpLocalConfigJSON `json:"-"`
}

// mcpLocalConfigJSON contains the JSON metadata for the struct [McpLocalConfig]
type mcpLocalConfigJSON struct {
	Command     apijson.Field
	Type        apijson.Field
	Enabled     apijson.Field
	Environment apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *McpLocalConfig) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r mcpLocalConfigJSON) RawJSON() string {
	return r.raw
}

func (r McpLocalConfig) implementsConfigMcp() {}

// Type of MCP server connection
type McpLocalConfigType string

const (
	McpLocalConfigTypeLocal McpLocalConfigType = "local"
)

func (r McpLocalConfigType) IsKnown() bool {
	switch r {
	case McpLocalConfigTypeLocal:
		return true
	}
	return false
}

type McpRemoteConfig struct {
	// Type of MCP server connection
	Type McpRemoteConfigType `json:"type,required"`
	// URL of the remote MCP server
	URL string `json:"url,required"`
	// Enable or disable the MCP server on startup
	Enabled bool `json:"enabled"`
	// Headers to send with the request
	Headers map[string]string   `json:"headers"`
	JSON    mcpRemoteConfigJSON `json:"-"`
}

// mcpRemoteConfigJSON contains the JSON metadata for the struct [McpRemoteConfig]
type mcpRemoteConfigJSON struct {
	Type        apijson.Field
	URL         apijson.Field
	Enabled     apijson.Field
	Headers     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *McpRemoteConfig) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r mcpRemoteConfigJSON) RawJSON() string {
	return r.raw
}

func (r McpRemoteConfig) implementsConfigMcp() {}

// Type of MCP server connection
type McpRemoteConfigType string

const (
	McpRemoteConfigTypeRemote McpRemoteConfigType = "remote"
)

func (r McpRemoteConfigType) IsKnown() bool {
	switch r {
	case McpRemoteConfigTypeRemote:
		return true
	}
	return false
}

type ModeConfig struct {
	Model  string          `json:"model"`
	Prompt string          `json:"prompt"`
	Tools  map[string]bool `json:"tools"`
	JSON   modeConfigJSON  `json:"-"`
}

// modeConfigJSON contains the JSON metadata for the struct [ModeConfig]
type modeConfigJSON struct {
	Model       apijson.Field
	Prompt      apijson.Field
	Tools       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ModeConfig) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r modeConfigJSON) RawJSON() string {
	return r.raw
}
