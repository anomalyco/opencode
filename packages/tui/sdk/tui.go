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
func (r *TuiService) AppendPrompt(ctx context.Context, body TuiAppendPromptParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	path := "tui/append-prompt"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Open the help dialog
func (r *TuiService) OpenHelp(ctx context.Context, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	path := "tui/open-help"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, nil, &res, opts...)
	return
}

type TuiAppendPromptParams struct {
	Text param.Field[string] `json:"text,required"`
}

func (r TuiAppendPromptParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}
