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

// CommandService contains methods and other services that help with interacting
// with the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewCommandService] method instead.
type CommandService struct {
	Options []option.RequestOption
}

// NewCommandService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewCommandService(opts ...option.RequestOption) (r *CommandService) {
	r = &CommandService{}
	r.Options = opts
	return
}

// List all commands
func (r *CommandService) List(ctx context.Context, query CommandListParams, opts ...option.RequestOption) (res *[]Command, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "command"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

type Command struct {
	Name        string      `json:"name,required"`
	Template    string      `json:"template,required"`
	Agent       string      `json:"agent"`
	Description string      `json:"description"`
	Model       string      `json:"model"`
	Subtask     bool        `json:"subtask"`
	JSON        commandJSON `json:"-"`
}

// commandJSON contains the JSON metadata for the struct [Command]
type commandJSON struct {
	Name        apijson.Field
	Template    apijson.Field
	Agent       apijson.Field
	Description apijson.Field
	Model       apijson.Field
	Subtask     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Command) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r commandJSON) RawJSON() string {
	return r.raw
}

type CommandListParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [CommandListParams]'s query parameters as `url.Values`.
func (r CommandListParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}
