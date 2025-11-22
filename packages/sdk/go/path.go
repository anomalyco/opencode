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

// PathService contains methods and other services that help with interacting with
// the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewPathService] method instead.
type PathService struct {
	Options []option.RequestOption
}

// NewPathService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewPathService(opts ...option.RequestOption) (r *PathService) {
	r = &PathService{}
	r.Options = opts
	return
}

// Get the current path
func (r *PathService) Get(ctx context.Context, query PathGetParams, opts ...option.RequestOption) (res *Path, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "path"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

type Path struct {
	Config    string   `json:"config,required"`
	Directory string   `json:"directory,required"`
	State     string   `json:"state,required"`
	Worktree  string   `json:"worktree,required"`
	JSON      pathJSON `json:"-"`
}

// pathJSON contains the JSON metadata for the struct [Path]
type pathJSON struct {
	Config      apijson.Field
	Directory   apijson.Field
	State       apijson.Field
	Worktree    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Path) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r pathJSON) RawJSON() string {
	return r.raw
}

type PathGetParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [PathGetParams]'s query parameters as `url.Values`.
func (r PathGetParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}
