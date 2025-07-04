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

// List all providers
func (r *ConfigService) Providers(ctx context.Context, opts ...option.RequestOption) (res *ConfigProvidersResponse, err error) {
	opts = append(r.Options[:], opts...)
	path := "config/providers"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, nil, &res, opts...)
	return
}

type Config struct {
	// JSON schema reference for configuration validation
	Schema string `json:"$schema"`
	// Share newly created sessions automatically
	Autoshare bool `json:"autoshare"`
	// Automatically update to the latest version
	Autoupdate bool `json:"autoupdate"`
	// Disable providers that are loaded automatically
	DisabledProviders []string           `json:"disabled_providers"`
	Experimental      ConfigExperimental `json:"experimental"`
	// Additional instruction files or patterns to include
	Instructions []string `json:"instructions"`
	// Custom keybind configurations
	Keybinds Keybinds `json:"keybinds"`
	// MCP (Model Context Protocol) server configurations
	Mcp map[string]ConfigMcp `json:"mcp"`
	// Model to use in the format of provider/model, eg anthropic/claude-2
	Model string `json:"model"`
	// Custom provider configurations and model overrides
	Provider map[string]ConfigProvider `json:"provider"`
	// Theme name to use for the interface
	Theme string     `json:"theme"`
	JSON  configJSON `json:"-"`
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
	Mcp               apijson.Field
	Model             apijson.Field
	Provider          apijson.Field
	Theme             apijson.Field
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

type ConfigMcp struct {
	// Type of MCP server connection
	Type ConfigMcpType `json:"type,required"`
	// This field can have the runtime type of [[]string].
	Command interface{} `json:"command"`
	// Enable or disable the MCP server on startup
	Enabled bool `json:"enabled"`
	// This field can have the runtime type of [map[string]string].
	Environment interface{} `json:"environment"`
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
// Possible runtime types of the union are [McpLocal], [McpRemote].
func (r ConfigMcp) AsUnion() ConfigMcpUnion {
	return r.union
}

// Union satisfied by [McpLocal] or [McpRemote].
type ConfigMcpUnion interface {
	implementsConfigMcp()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*ConfigMcpUnion)(nil)).Elem(),
		"type",
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(McpLocal{}),
			DiscriminatorValue: "local",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(McpRemote{}),
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

type ConfigProvider struct {
	Models  map[string]ConfigProviderModel `json:"models,required"`
	ID      string                         `json:"id"`
	API     string                         `json:"api"`
	Env     []string                       `json:"env"`
	Name    string                         `json:"name"`
	Npm     string                         `json:"npm"`
	Options map[string]interface{}         `json:"options"`
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

type Keybinds struct {
	// Exit the application
	AppExit string `json:"app_exit"`
	// Open external editor
	EditorOpen string `json:"editor_open"`
	// Show help dialog
	Help string `json:"help"`
	// Navigate to next history item
	HistoryNext string `json:"history_next"`
	// Navigate to previous history item
	HistoryPrevious string `json:"history_previous"`
	// Clear input field
	InputClear string `json:"input_clear"`
	// Insert newline in input
	InputNewline string `json:"input_newline"`
	// Paste from clipboard
	InputPaste string `json:"input_paste"`
	// Submit input
	InputSubmit string `json:"input_submit"`
	// Leader key for keybind combinations
	Leader string `json:"leader"`
	// Navigate to first message
	MessagesFirst string `json:"messages_first"`
	// Scroll messages down by half page
	MessagesHalfPageDown string `json:"messages_half_page_down"`
	// Scroll messages up by half page
	MessagesHalfPageUp string `json:"messages_half_page_up"`
	// Navigate to last message
	MessagesLast string `json:"messages_last"`
	// Navigate to next message
	MessagesNext string `json:"messages_next"`
	// Scroll messages down by one page
	MessagesPageDown string `json:"messages_page_down"`
	// Scroll messages up by one page
	MessagesPageUp string `json:"messages_page_up"`
	// Navigate to previous message
	MessagesPrevious string `json:"messages_previous"`
	// List available models
	ModelList string `json:"model_list"`
	// Initialize project configuration
	ProjectInit string `json:"project_init"`
	// Toggle compact mode for session
	SessionCompact string `json:"session_compact"`
	// Interrupt current session
	SessionInterrupt string `json:"session_interrupt"`
	// List all sessions
	SessionList string `json:"session_list"`
	// Create a new session
	SessionNew string `json:"session_new"`
	// Share current session
	SessionShare string `json:"session_share"`
	// List available themes
	ThemeList string `json:"theme_list"`
	// Show tool details
	ToolDetails string       `json:"tool_details"`
	JSON        keybindsJSON `json:"-"`
}

// keybindsJSON contains the JSON metadata for the struct [Keybinds]
type keybindsJSON struct {
	AppExit              apijson.Field
	EditorOpen           apijson.Field
	Help                 apijson.Field
	HistoryNext          apijson.Field
	HistoryPrevious      apijson.Field
	InputClear           apijson.Field
	InputNewline         apijson.Field
	InputPaste           apijson.Field
	InputSubmit          apijson.Field
	Leader               apijson.Field
	MessagesFirst        apijson.Field
	MessagesHalfPageDown apijson.Field
	MessagesHalfPageUp   apijson.Field
	MessagesLast         apijson.Field
	MessagesNext         apijson.Field
	MessagesPageDown     apijson.Field
	MessagesPageUp       apijson.Field
	MessagesPrevious     apijson.Field
	ModelList            apijson.Field
	ProjectInit          apijson.Field
	SessionCompact       apijson.Field
	SessionInterrupt     apijson.Field
	SessionList          apijson.Field
	SessionNew           apijson.Field
	SessionShare         apijson.Field
	ThemeList            apijson.Field
	ToolDetails          apijson.Field
	raw                  string
	ExtraFields          map[string]apijson.Field
}

func (r *Keybinds) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r keybindsJSON) RawJSON() string {
	return r.raw
}

type McpLocal struct {
	// Command and arguments to run the MCP server
	Command []string `json:"command,required"`
	// Type of MCP server connection
	Type McpLocalType `json:"type,required"`
	// Enable or disable the MCP server on startup
	Enabled bool `json:"enabled"`
	// Environment variables to set when running the MCP server
	Environment map[string]string `json:"environment"`
	JSON        mcpLocalJSON      `json:"-"`
}

// mcpLocalJSON contains the JSON metadata for the struct [McpLocal]
type mcpLocalJSON struct {
	Command     apijson.Field
	Type        apijson.Field
	Enabled     apijson.Field
	Environment apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *McpLocal) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r mcpLocalJSON) RawJSON() string {
	return r.raw
}

func (r McpLocal) implementsConfigMcp() {}

// Type of MCP server connection
type McpLocalType string

const (
	McpLocalTypeLocal McpLocalType = "local"
)

func (r McpLocalType) IsKnown() bool {
	switch r {
	case McpLocalTypeLocal:
		return true
	}
	return false
}

type McpRemote struct {
	// Type of MCP server connection
	Type McpRemoteType `json:"type,required"`
	// URL of the remote MCP server
	URL string `json:"url,required"`
	// Enable or disable the MCP server on startup
	Enabled bool          `json:"enabled"`
	JSON    mcpRemoteJSON `json:"-"`
}

// mcpRemoteJSON contains the JSON metadata for the struct [McpRemote]
type mcpRemoteJSON struct {
	Type        apijson.Field
	URL         apijson.Field
	Enabled     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *McpRemote) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r mcpRemoteJSON) RawJSON() string {
	return r.raw
}

func (r McpRemote) implementsConfigMcp() {}

// Type of MCP server connection
type McpRemoteType string

const (
	McpRemoteTypeRemote McpRemoteType = "remote"
)

func (r McpRemoteType) IsKnown() bool {
	switch r {
	case McpRemoteTypeRemote:
		return true
	}
	return false
}

type Model struct {
	ID          string                 `json:"id,required"`
	Attachment  bool                   `json:"attachment,required"`
	Cost        ModelCost              `json:"cost,required"`
	Limit       ModelLimit             `json:"limit,required"`
	Name        string                 `json:"name,required"`
	Options     map[string]interface{} `json:"options,required"`
	Reasoning   bool                   `json:"reasoning,required"`
	ReleaseDate string                 `json:"release_date,required"`
	Temperature bool                   `json:"temperature,required"`
	ToolCall    bool                   `json:"tool_call,required"`
	JSON        modelJSON              `json:"-"`
}

// modelJSON contains the JSON metadata for the struct [Model]
type modelJSON struct {
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

func (r *Model) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r modelJSON) RawJSON() string {
	return r.raw
}

type ModelCost struct {
	Input      float64       `json:"input,required"`
	Output     float64       `json:"output,required"`
	CacheRead  float64       `json:"cache_read"`
	CacheWrite float64       `json:"cache_write"`
	JSON       modelCostJSON `json:"-"`
}

// modelCostJSON contains the JSON metadata for the struct [ModelCost]
type modelCostJSON struct {
	Input       apijson.Field
	Output      apijson.Field
	CacheRead   apijson.Field
	CacheWrite  apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ModelCost) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r modelCostJSON) RawJSON() string {
	return r.raw
}

type ModelLimit struct {
	Context float64        `json:"context,required"`
	Output  float64        `json:"output,required"`
	JSON    modelLimitJSON `json:"-"`
}

// modelLimitJSON contains the JSON metadata for the struct [ModelLimit]
type modelLimitJSON struct {
	Context     apijson.Field
	Output      apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ModelLimit) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r modelLimitJSON) RawJSON() string {
	return r.raw
}

type Provider struct {
	ID     string           `json:"id,required"`
	Env    []string         `json:"env,required"`
	Models map[string]Model `json:"models,required"`
	Name   string           `json:"name,required"`
	API    string           `json:"api"`
	Npm    string           `json:"npm"`
	JSON   providerJSON     `json:"-"`
}

// providerJSON contains the JSON metadata for the struct [Provider]
type providerJSON struct {
	ID          apijson.Field
	Env         apijson.Field
	Models      apijson.Field
	Name        apijson.Field
	API         apijson.Field
	Npm         apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Provider) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r providerJSON) RawJSON() string {
	return r.raw
}

type ConfigProvidersResponse struct {
	Default   map[string]string           `json:"default,required"`
	Providers []Provider                  `json:"providers,required"`
	JSON      configProvidersResponseJSON `json:"-"`
}

// configProvidersResponseJSON contains the JSON metadata for the struct
// [ConfigProvidersResponse]
type configProvidersResponseJSON struct {
	Default     apijson.Field
	Providers   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ConfigProvidersResponse) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r configProvidersResponseJSON) RawJSON() string {
	return r.raw
}
