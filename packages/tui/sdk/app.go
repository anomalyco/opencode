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

type App struct {
	Git      bool    `json:"git,required"`
	Hostname string  `json:"hostname,required"`
	Path     AppPath `json:"path,required"`
	Time     AppTime `json:"time,required"`
	User     string  `json:"user,required"`
	JSON     appJSON `json:"-"`
}

// appJSON contains the JSON metadata for the struct [App]
type appJSON struct {
	Git         apijson.Field
	Hostname    apijson.Field
	Path        apijson.Field
	Time        apijson.Field
	User        apijson.Field
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

// Log level
type LogLevel string

const (
	LogLevelDebug LogLevel = "DEBUG"
	LogLevelInfo  LogLevel = "INFO"
	LogLevelWarn  LogLevel = "WARN"
	LogLevelError LogLevel = "ERROR"
)

func (r LogLevel) IsKnown() bool {
	switch r {
	case LogLevelDebug, LogLevelInfo, LogLevelWarn, LogLevelError:
		return true
	}
	return false
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
