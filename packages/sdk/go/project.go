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

// ProjectService contains methods and other services that help with interacting
// with the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewProjectService] method instead.
type ProjectService struct {
	Options []option.RequestOption
}

// NewProjectService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewProjectService(opts ...option.RequestOption) (r *ProjectService) {
	r = &ProjectService{}
	r.Options = opts
	return
}

// List all projects
func (r *ProjectService) List(ctx context.Context, query ProjectListParams, opts ...option.RequestOption) (res *[]Project, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "project"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Get the current project
func (r *ProjectService) Current(ctx context.Context, query ProjectCurrentParams, opts ...option.RequestOption) (res *Project, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "project/current"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

type Project struct {
	ID       string      `json:"id,required"`
	Time     ProjectTime `json:"time,required"`
	Worktree string      `json:"worktree,required"`
	Vcs      ProjectVcs  `json:"vcs"`
	JSON     projectJSON `json:"-"`
}

// projectJSON contains the JSON metadata for the struct [Project]
type projectJSON struct {
	ID          apijson.Field
	Time        apijson.Field
	Worktree    apijson.Field
	Vcs         apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Project) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r projectJSON) RawJSON() string {
	return r.raw
}

type ProjectTime struct {
	Created     float64         `json:"created,required"`
	Initialized float64         `json:"initialized"`
	JSON        projectTimeJSON `json:"-"`
}

// projectTimeJSON contains the JSON metadata for the struct [ProjectTime]
type projectTimeJSON struct {
	Created     apijson.Field
	Initialized apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ProjectTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r projectTimeJSON) RawJSON() string {
	return r.raw
}

type ProjectVcs string

const (
	ProjectVcsGit ProjectVcs = "git"
)

func (r ProjectVcs) IsKnown() bool {
	switch r {
	case ProjectVcsGit:
		return true
	}
	return false
}

type ProjectListParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [ProjectListParams]'s query parameters as `url.Values`.
func (r ProjectListParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type ProjectCurrentParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [ProjectCurrentParams]'s query parameters as `url.Values`.
func (r ProjectCurrentParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}
