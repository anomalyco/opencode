// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"net/http"
	"net/url"

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
	opts = append(r.Options[:], opts...)
	path := "find/file"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Find workspace symbols
func (r *FindService) Symbols(ctx context.Context, query FindSymbolsParams, opts ...option.RequestOption) (res *[]Symbol, err error) {
	opts = append(r.Options[:], opts...)
	path := "find/symbol"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Find text in files
func (r *FindService) Text(ctx context.Context, query FindTextParams, opts ...option.RequestOption) (res *[]Match, err error) {
	opts = append(r.Options[:], opts...)
	path := "find"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

type Match struct {
	AbsoluteOffset float64         `json:"absolute_offset,required"`
	LineNumber     float64         `json:"line_number,required"`
	Lines          MatchLines      `json:"lines,required"`
	Path           MatchPath       `json:"path,required"`
	Submatches     []MatchSubmatch `json:"submatches,required"`
	JSON           matchJSON       `json:"-"`
}

// matchJSON contains the JSON metadata for the struct [Match]
type matchJSON struct {
	AbsoluteOffset apijson.Field
	LineNumber     apijson.Field
	Lines          apijson.Field
	Path           apijson.Field
	Submatches     apijson.Field
	raw            string
	ExtraFields    map[string]apijson.Field
}

func (r *Match) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r matchJSON) RawJSON() string {
	return r.raw
}

type MatchLines struct {
	Text string         `json:"text,required"`
	JSON matchLinesJSON `json:"-"`
}

// matchLinesJSON contains the JSON metadata for the struct [MatchLines]
type matchLinesJSON struct {
	Text        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MatchLines) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r matchLinesJSON) RawJSON() string {
	return r.raw
}

type MatchPath struct {
	Text string        `json:"text,required"`
	JSON matchPathJSON `json:"-"`
}

// matchPathJSON contains the JSON metadata for the struct [MatchPath]
type matchPathJSON struct {
	Text        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MatchPath) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r matchPathJSON) RawJSON() string {
	return r.raw
}

type MatchSubmatch struct {
	End   float64              `json:"end,required"`
	Match MatchSubmatchesMatch `json:"match,required"`
	Start float64              `json:"start,required"`
	JSON  matchSubmatchJSON    `json:"-"`
}

// matchSubmatchJSON contains the JSON metadata for the struct [MatchSubmatch]
type matchSubmatchJSON struct {
	End         apijson.Field
	Match       apijson.Field
	Start       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MatchSubmatch) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r matchSubmatchJSON) RawJSON() string {
	return r.raw
}

type MatchSubmatchesMatch struct {
	Text string                   `json:"text,required"`
	JSON matchSubmatchesMatchJSON `json:"-"`
}

// matchSubmatchesMatchJSON contains the JSON metadata for the struct
// [MatchSubmatchesMatch]
type matchSubmatchesMatchJSON struct {
	Text        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MatchSubmatchesMatch) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r matchSubmatchesMatchJSON) RawJSON() string {
	return r.raw
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

type FindFilesParams struct {
	Query param.Field[string] `query:"query,required"`
}

// URLQuery serializes [FindFilesParams]'s query parameters as `url.Values`.
func (r FindFilesParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type FindSymbolsParams struct {
	Query param.Field[string] `query:"query,required"`
}

// URLQuery serializes [FindSymbolsParams]'s query parameters as `url.Values`.
func (r FindSymbolsParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type FindTextParams struct {
	Pattern param.Field[string] `query:"pattern,required"`
}

// URLQuery serializes [FindTextParams]'s query parameters as `url.Values`.
func (r FindTextParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}
