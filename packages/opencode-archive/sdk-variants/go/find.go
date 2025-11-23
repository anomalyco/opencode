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

// FindService contains methods and other services that help with interacting with
// the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewFindService] method instead.
type FindService struct {
	Options []option.RequestOption
}

// NewFindService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewFindService(opts ...option.RequestOption) (r *FindService) {
	r = &FindService{}
	r.Options = opts
	return
}

// Find files
func (r *FindService) Files(ctx context.Context, query FindFilesParams, opts ...option.RequestOption) (res *[]string, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "find/file"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Find workspace symbols
func (r *FindService) Symbols(ctx context.Context, query FindSymbolsParams, opts ...option.RequestOption) (res *[]Symbol, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "find/symbol"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Find text in files
func (r *FindService) Text(ctx context.Context, query FindTextParams, opts ...option.RequestOption) (res *[]FindTextResponse, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "find"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

type Symbol struct {
	Kind     float64        `json:"kind,required"`
	Location SymbolLocation `json:"location,required"`
	Name     string         `json:"name,required"`
	JSON     symbolJSON     `json:"-"`
}

// symbolJSON contains the JSON metadata for the struct [Symbol]
type symbolJSON struct {
	Kind        apijson.Field
	Location    apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Symbol) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolJSON) RawJSON() string {
	return r.raw
}

type SymbolLocation struct {
	Range SymbolLocationRange `json:"range,required"`
	Uri   string              `json:"uri,required"`
	JSON  symbolLocationJSON  `json:"-"`
}

// symbolLocationJSON contains the JSON metadata for the struct [SymbolLocation]
type symbolLocationJSON struct {
	Range       apijson.Field
	Uri         apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SymbolLocation) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolLocationJSON) RawJSON() string {
	return r.raw
}

type SymbolLocationRange struct {
	End   SymbolLocationRangeEnd   `json:"end,required"`
	Start SymbolLocationRangeStart `json:"start,required"`
	JSON  symbolLocationRangeJSON  `json:"-"`
}

// symbolLocationRangeJSON contains the JSON metadata for the struct
// [SymbolLocationRange]
type symbolLocationRangeJSON struct {
	End         apijson.Field
	Start       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SymbolLocationRange) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolLocationRangeJSON) RawJSON() string {
	return r.raw
}

type SymbolLocationRangeEnd struct {
	Character float64                    `json:"character,required"`
	Line      float64                    `json:"line,required"`
	JSON      symbolLocationRangeEndJSON `json:"-"`
}

// symbolLocationRangeEndJSON contains the JSON metadata for the struct
// [SymbolLocationRangeEnd]
type symbolLocationRangeEndJSON struct {
	Character   apijson.Field
	Line        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SymbolLocationRangeEnd) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolLocationRangeEndJSON) RawJSON() string {
	return r.raw
}

type SymbolLocationRangeStart struct {
	Character float64                      `json:"character,required"`
	Line      float64                      `json:"line,required"`
	JSON      symbolLocationRangeStartJSON `json:"-"`
}

// symbolLocationRangeStartJSON contains the JSON metadata for the struct
// [SymbolLocationRangeStart]
type symbolLocationRangeStartJSON struct {
	Character   apijson.Field
	Line        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SymbolLocationRangeStart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolLocationRangeStartJSON) RawJSON() string {
	return r.raw
}

type FindTextResponse struct {
	AbsoluteOffset float64                    `json:"absolute_offset,required"`
	LineNumber     float64                    `json:"line_number,required"`
	Lines          FindTextResponseLines      `json:"lines,required"`
	Path           FindTextResponsePath       `json:"path,required"`
	Submatches     []FindTextResponseSubmatch `json:"submatches,required"`
	JSON           findTextResponseJSON       `json:"-"`
}

// findTextResponseJSON contains the JSON metadata for the struct
// [FindTextResponse]
type findTextResponseJSON struct {
	AbsoluteOffset apijson.Field
	LineNumber     apijson.Field
	Lines          apijson.Field
	Path           apijson.Field
	Submatches     apijson.Field
	raw            string
	ExtraFields    map[string]apijson.Field
}

func (r *FindTextResponse) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r findTextResponseJSON) RawJSON() string {
	return r.raw
}

type FindTextResponseLines struct {
	Text string                    `json:"text,required"`
	JSON findTextResponseLinesJSON `json:"-"`
}

// findTextResponseLinesJSON contains the JSON metadata for the struct
// [FindTextResponseLines]
type findTextResponseLinesJSON struct {
	Text        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *FindTextResponseLines) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r findTextResponseLinesJSON) RawJSON() string {
	return r.raw
}

type FindTextResponsePath struct {
	Text string                   `json:"text,required"`
	JSON findTextResponsePathJSON `json:"-"`
}

// findTextResponsePathJSON contains the JSON metadata for the struct
// [FindTextResponsePath]
type findTextResponsePathJSON struct {
	Text        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *FindTextResponsePath) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r findTextResponsePathJSON) RawJSON() string {
	return r.raw
}

type FindTextResponseSubmatch struct {
	End   float64                         `json:"end,required"`
	Match FindTextResponseSubmatchesMatch `json:"match,required"`
	Start float64                         `json:"start,required"`
	JSON  findTextResponseSubmatchJSON    `json:"-"`
}

// findTextResponseSubmatchJSON contains the JSON metadata for the struct
// [FindTextResponseSubmatch]
type findTextResponseSubmatchJSON struct {
	End         apijson.Field
	Match       apijson.Field
	Start       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *FindTextResponseSubmatch) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r findTextResponseSubmatchJSON) RawJSON() string {
	return r.raw
}

type FindTextResponseSubmatchesMatch struct {
	Text string                              `json:"text,required"`
	JSON findTextResponseSubmatchesMatchJSON `json:"-"`
}

// findTextResponseSubmatchesMatchJSON contains the JSON metadata for the struct
// [FindTextResponseSubmatchesMatch]
type findTextResponseSubmatchesMatchJSON struct {
	Text        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *FindTextResponseSubmatchesMatch) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r findTextResponseSubmatchesMatchJSON) RawJSON() string {
	return r.raw
}

type FindFilesParams struct {
	Query     param.Field[string] `query:"query,required"`
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [FindFilesParams]'s query parameters as `url.Values`.
func (r FindFilesParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type FindSymbolsParams struct {
	Query     param.Field[string] `query:"query,required"`
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [FindSymbolsParams]'s query parameters as `url.Values`.
func (r FindSymbolsParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type FindTextParams struct {
	Pattern   param.Field[string] `query:"pattern,required"`
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [FindTextParams]'s query parameters as `url.Values`.
func (r FindTextParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}
