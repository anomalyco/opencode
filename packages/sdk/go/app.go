// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"net/http"

	"github.com/sst/opencode-sdk-go/internal/apijson"
	"github.com/sst/opencode-sdk-go/internal/param"
	"github.com/sst/opencode-sdk-go/internal/requestconfig"
	"github.com/sst/opencode-sdk-go/option"
)

// AppService contains methods and other services that help with interacting with
// the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewAppService] method instead.
type AppService struct {
	Options []option.RequestOption
}

// NewAppService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewAppService(opts ...option.RequestOption) (r *AppService) {
	r = &AppService{}
	r.Options = opts
	return
}

// Get app info
func (r *AppService) Get(ctx context.Context, opts ...option.RequestOption) (res *App, err error) {
	opts = append(r.Options[:], opts...)
	path := "app"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, nil, &res, opts...)
	return
}

// Initialize the app
func (r *AppService) Init(ctx context.Context, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	path := "app/init"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, nil, &res, opts...)
	return
}

// Write a log entry to the server logs
func (r *AppService) Log(ctx context.Context, body AppLogParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	path := "log"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// List all modes
func (r *AppService) Modes(ctx context.Context, opts ...option.RequestOption) (res *[]Mode, err error) {
	opts = append(r.Options[:], opts...)
	path := "mode"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, nil, &res, opts...)
	return
}

// List all providers
func (r *AppService) Providers(ctx context.Context, opts ...option.RequestOption) (res *AppProvidersResponse, err error) {
	opts = append(r.Options[:], opts...)
	path := "config/providers"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, nil, &res, opts...)
	return
}

type App struct {
	Git      bool    `json:"git,required"`
	Hostname string  `json:"hostname,required"`
	Path     AppPath `json:"path,required"`
	Time     AppTime `json:"time,required"`
	JSON     appJSON `json:"-"`
}

// appJSON contains the JSON metadata for the struct [App]
type appJSON struct {
	Git         apijson.Field
	Hostname    apijson.Field
	Path        apijson.Field
	Time        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *App) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r appJSON) RawJSON() string {
	return r.raw
}

type AppPath struct {
	Config string      `json:"config,required"`
	Cwd    string      `json:"cwd,required"`
	Data   string      `json:"data,required"`
	Root   string      `json:"root,required"`
	State  string      `json:"state,required"`
	JSON   appPathJSON `json:"-"`
}

// appPathJSON contains the JSON metadata for the struct [AppPath]
type appPathJSON struct {
	Config      apijson.Field
	Cwd         apijson.Field
	Data        apijson.Field
	Root        apijson.Field
	State       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AppPath) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r appPathJSON) RawJSON() string {
	return r.raw
}

type AppTime struct {
	Initialized float64     `json:"initialized"`
	JSON        appTimeJSON `json:"-"`
}

// appTimeJSON contains the JSON metadata for the struct [AppTime]
type appTimeJSON struct {
	Initialized apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AppTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r appTimeJSON) RawJSON() string {
	return r.raw
}

type Mode struct {
	Name        string          `json:"name,required"`
	Tools       map[string]bool `json:"tools,required"`
	Model       ModeModel       `json:"model"`
	Prompt      string          `json:"prompt"`
	Temperature float64         `json:"temperature"`
	JSON        modeJSON        `json:"-"`
}

// modeJSON contains the JSON metadata for the struct [Mode]
type modeJSON struct {
	Name        apijson.Field
	Tools       apijson.Field
	Model       apijson.Field
	Prompt      apijson.Field
	Temperature apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Mode) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r modeJSON) RawJSON() string {
	return r.raw
}

type ModeModel struct {
	ModelID    string        `json:"modelID,required"`
	ProviderID string        `json:"providerID,required"`
	JSON       modeModelJSON `json:"-"`
}

// modeModelJSON contains the JSON metadata for the struct [ModeModel]
type modeModelJSON struct {
	ModelID     apijson.Field
	ProviderID  apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ModeModel) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r modeModelJSON) RawJSON() string {
	return r.raw
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

type AppProvidersResponse struct {
	Default   map[string]string        `json:"default,required"`
	Providers []Provider               `json:"providers,required"`
	JSON      appProvidersResponseJSON `json:"-"`
}

// appProvidersResponseJSON contains the JSON metadata for the struct
// [AppProvidersResponse]
type appProvidersResponseJSON struct {
	Default     apijson.Field
	Providers   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AppProvidersResponse) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r appProvidersResponseJSON) RawJSON() string {
	return r.raw
}

type AppLogParams struct {
	// Log level
	Level param.Field[AppLogParamsLevel] `json:"level,required"`
	// Log message
	Message param.Field[string] `json:"message,required"`
	// Service name for the log entry
	Service param.Field[string] `json:"service,required"`
	// Additional metadata for the log entry
	Extra param.Field[map[string]interface{}] `json:"extra"`
}

func (r AppLogParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// Log level
type AppLogParamsLevel string

const (
	AppLogParamsLevelDebug AppLogParamsLevel = "debug"
	AppLogParamsLevelInfo  AppLogParamsLevel = "info"
	AppLogParamsLevelError AppLogParamsLevel = "error"
	AppLogParamsLevelWarn  AppLogParamsLevel = "warn"
)

func (r AppLogParamsLevel) IsKnown() bool {
	switch r {
	case AppLogParamsLevelDebug, AppLogParamsLevelInfo, AppLogParamsLevelError, AppLogParamsLevelWarn:
		return true
	}
	return false
}
