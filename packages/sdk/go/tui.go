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

// TuiService contains methods and other services that help with interacting with
// the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewTuiService] method instead.
type TuiService struct {
	Options []option.RequestOption
}

// NewTuiService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewTuiService(opts ...option.RequestOption) (r *TuiService) {
	r = &TuiService{}
	r.Options = opts
	return
}

// Append prompt to the TUI
func (r *TuiService) AppendPrompt(ctx context.Context, params TuiAppendPromptParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/append-prompt"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Clear the prompt
func (r *TuiService) ClearPrompt(ctx context.Context, body TuiClearPromptParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/clear-prompt"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Execute a TUI command (e.g. agent_cycle)
func (r *TuiService) ExecuteCommand(ctx context.Context, params TuiExecuteCommandParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/execute-command"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Open the help dialog
func (r *TuiService) OpenHelp(ctx context.Context, body TuiOpenHelpParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/open-help"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Open the model dialog
func (r *TuiService) OpenModels(ctx context.Context, body TuiOpenModelsParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/open-models"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Open the session dialog
func (r *TuiService) OpenSessions(ctx context.Context, body TuiOpenSessionsParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/open-sessions"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Open the theme dialog
func (r *TuiService) OpenThemes(ctx context.Context, body TuiOpenThemesParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/open-themes"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Show a toast notification in the TUI
func (r *TuiService) ShowToast(ctx context.Context, params TuiShowToastParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/show-toast"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Submit the prompt
func (r *TuiService) SubmitPrompt(ctx context.Context, body TuiSubmitPromptParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "tui/submit-prompt"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

type TuiAppendPromptParams struct {
	Text      param.Field[string] `json:"text,required"`
	Directory param.Field[string] `query:"directory"`
}

func (r TuiAppendPromptParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [TuiAppendPromptParams]'s query parameters as `url.Values`.
func (r TuiAppendPromptParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type TuiClearPromptParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [TuiClearPromptParams]'s query parameters as `url.Values`.
func (r TuiClearPromptParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type TuiExecuteCommandParams struct {
	Command   param.Field[string] `json:"command,required"`
	Directory param.Field[string] `query:"directory"`
}

func (r TuiExecuteCommandParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [TuiExecuteCommandParams]'s query parameters as
// `url.Values`.
func (r TuiExecuteCommandParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type TuiOpenHelpParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [TuiOpenHelpParams]'s query parameters as `url.Values`.
func (r TuiOpenHelpParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type TuiOpenModelsParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [TuiOpenModelsParams]'s query parameters as `url.Values`.
func (r TuiOpenModelsParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type TuiOpenSessionsParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [TuiOpenSessionsParams]'s query parameters as `url.Values`.
func (r TuiOpenSessionsParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type TuiOpenThemesParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [TuiOpenThemesParams]'s query parameters as `url.Values`.
func (r TuiOpenThemesParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type TuiShowToastParams struct {
	Message   param.Field[string]                    `json:"message,required"`
	Variant   param.Field[TuiShowToastParamsVariant] `json:"variant,required"`
	Directory param.Field[string]                    `query:"directory"`
	Title     param.Field[string]                    `json:"title"`
}

func (r TuiShowToastParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [TuiShowToastParams]'s query parameters as `url.Values`.
func (r TuiShowToastParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type TuiShowToastParamsVariant string

const (
	TuiShowToastParamsVariantInfo    TuiShowToastParamsVariant = "info"
	TuiShowToastParamsVariantSuccess TuiShowToastParamsVariant = "success"
	TuiShowToastParamsVariantWarning TuiShowToastParamsVariant = "warning"
	TuiShowToastParamsVariantError   TuiShowToastParamsVariant = "error"
)

func (r TuiShowToastParamsVariant) IsKnown() bool {
	switch r {
	case TuiShowToastParamsVariantInfo, TuiShowToastParamsVariantSuccess, TuiShowToastParamsVariantWarning, TuiShowToastParamsVariantError:
		return true
	}
	return false
}

type TuiSubmitPromptParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [TuiSubmitPromptParams]'s query parameters as `url.Values`.
func (r TuiSubmitPromptParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}
