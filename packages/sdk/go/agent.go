// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"net/http"
	"net/url"
	"slices"

	"github.com/sst/opencode-sdk-go/internal/apijson"
	"github.com/sst/opencode-sdk-go/internal/apiquery"
	"github.com/sst/opencode-sdk-go/internal/param"
	"github.com/sst/opencode-sdk-go/internal/requestconfig"
	"github.com/sst/opencode-sdk-go/option"
)

// AgentService contains methods and other services that help with interacting with
// the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewAgentService] method instead.
type AgentService struct {
	Options []option.RequestOption
}

// NewAgentService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewAgentService(opts ...option.RequestOption) (r *AgentService) {
	r = &AgentService{}
	r.Options = opts
	return
}

// List all agents
func (r *AgentService) List(ctx context.Context, query AgentListParams, opts ...option.RequestOption) (res *[]Agent, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "agent"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

type Agent struct {
	BuiltIn     bool                   `json:"builtIn,required"`
	Mode        AgentMode              `json:"mode,required"`
	Name        string                 `json:"name,required"`
	Options     map[string]interface{} `json:"options,required"`
	Permission  AgentPermission        `json:"permission,required"`
	Tools       map[string]bool        `json:"tools,required"`
	Color       string                 `json:"color"`
	Description string                 `json:"description"`
	Model       AgentModel             `json:"model"`
	Prompt      string                 `json:"prompt"`
	Temperature float64                `json:"temperature"`
	TopP        float64                `json:"topP"`
	JSON        agentJSON              `json:"-"`
}

// agentJSON contains the JSON metadata for the struct [Agent]
type agentJSON struct {
	BuiltIn     apijson.Field
	Mode        apijson.Field
	Name        apijson.Field
	Options     apijson.Field
	Permission  apijson.Field
	Tools       apijson.Field
	Color       apijson.Field
	Description apijson.Field
	Model       apijson.Field
	Prompt      apijson.Field
	Temperature apijson.Field
	TopP        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Agent) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r agentJSON) RawJSON() string {
	return r.raw
}

type AgentMode string

const (
	AgentModeSubagent AgentMode = "subagent"
	AgentModePrimary  AgentMode = "primary"
	AgentModeAll      AgentMode = "all"
)

func (r AgentMode) IsKnown() bool {
	switch r {
	case AgentModeSubagent, AgentModePrimary, AgentModeAll:
		return true
	}
	return false
}

type AgentPermission struct {
	Bash     map[string]AgentPermissionBash `json:"bash,required"`
	Edit     AgentPermissionEdit            `json:"edit,required"`
	Webfetch AgentPermissionWebfetch        `json:"webfetch"`
	JSON     agentPermissionJSON            `json:"-"`
}

// agentPermissionJSON contains the JSON metadata for the struct [AgentPermission]
type agentPermissionJSON struct {
	Bash        apijson.Field
	Edit        apijson.Field
	Webfetch    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AgentPermission) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r agentPermissionJSON) RawJSON() string {
	return r.raw
}

type AgentPermissionBash string

const (
	AgentPermissionBashAsk   AgentPermissionBash = "ask"
	AgentPermissionBashAllow AgentPermissionBash = "allow"
	AgentPermissionBashDeny  AgentPermissionBash = "deny"
)

func (r AgentPermissionBash) IsKnown() bool {
	switch r {
	case AgentPermissionBashAsk, AgentPermissionBashAllow, AgentPermissionBashDeny:
		return true
	}
	return false
}

type AgentPermissionEdit string

const (
	AgentPermissionEditAsk   AgentPermissionEdit = "ask"
	AgentPermissionEditAllow AgentPermissionEdit = "allow"
	AgentPermissionEditDeny  AgentPermissionEdit = "deny"
)

func (r AgentPermissionEdit) IsKnown() bool {
	switch r {
	case AgentPermissionEditAsk, AgentPermissionEditAllow, AgentPermissionEditDeny:
		return true
	}
	return false
}

type AgentPermissionWebfetch string

const (
	AgentPermissionWebfetchAsk   AgentPermissionWebfetch = "ask"
	AgentPermissionWebfetchAllow AgentPermissionWebfetch = "allow"
	AgentPermissionWebfetchDeny  AgentPermissionWebfetch = "deny"
)

func (r AgentPermissionWebfetch) IsKnown() bool {
	switch r {
	case AgentPermissionWebfetchAsk, AgentPermissionWebfetchAllow, AgentPermissionWebfetchDeny:
		return true
	}
	return false
}

type AgentModel struct {
	ModelID    string         `json:"modelID,required"`
	ProviderID string         `json:"providerID,required"`
	JSON       agentModelJSON `json:"-"`
}

// agentModelJSON contains the JSON metadata for the struct [AgentModel]
type agentModelJSON struct {
	ModelID     apijson.Field
	ProviderID  apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AgentModel) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r agentModelJSON) RawJSON() string {
	return r.raw
}

type AgentListParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [AgentListParams]'s query parameters as `url.Values`.
func (r AgentListParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}
