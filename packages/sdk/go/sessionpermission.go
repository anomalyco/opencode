// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"slices"

	"github.com/sst/opencode-sdk-go/internal/apijson"
	"github.com/sst/opencode-sdk-go/internal/apiquery"
	"github.com/sst/opencode-sdk-go/internal/param"
	"github.com/sst/opencode-sdk-go/internal/requestconfig"
	"github.com/sst/opencode-sdk-go/option"
	"github.com/sst/opencode-sdk-go/shared"
	"github.com/tidwall/gjson"
)

// SessionPermissionService contains methods and other services that help with
// interacting with the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewSessionPermissionService] method instead.
type SessionPermissionService struct {
	Options []option.RequestOption
}

// NewSessionPermissionService generates a new service that applies the given
// options to each request. These options are applied after the parent client's
// options (if there is one), and before any request-specific options.
func NewSessionPermissionService(opts ...option.RequestOption) (r *SessionPermissionService) {
	r = &SessionPermissionService{}
	r.Options = opts
	return
}

// Respond to a permission request
func (r *SessionPermissionService) Respond(ctx context.Context, id string, permissionID string, params SessionPermissionRespondParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	if permissionID == "" {
		err = errors.New("missing required permissionID parameter")
		return
	}
	path := fmt.Sprintf("session/%s/permissions/%s", id, permissionID)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

type Permission struct {
	ID        string                 `json:"id,required"`
	MessageID string                 `json:"messageID,required"`
	Metadata  map[string]interface{} `json:"metadata,required"`
	SessionID string                 `json:"sessionID,required"`
	Time      PermissionTime         `json:"time,required"`
	Title     string                 `json:"title,required"`
	Type      string                 `json:"type,required"`
	CallID    string                 `json:"callID"`
	Pattern   PermissionPatternUnion `json:"pattern"`
	JSON      permissionJSON         `json:"-"`
}

// permissionJSON contains the JSON metadata for the struct [Permission]
type permissionJSON struct {
	ID          apijson.Field
	MessageID   apijson.Field
	Metadata    apijson.Field
	SessionID   apijson.Field
	Time        apijson.Field
	Title       apijson.Field
	Type        apijson.Field
	CallID      apijson.Field
	Pattern     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Permission) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r permissionJSON) RawJSON() string {
	return r.raw
}

type PermissionTime struct {
	Created float64            `json:"created,required"`
	JSON    permissionTimeJSON `json:"-"`
}

// permissionTimeJSON contains the JSON metadata for the struct [PermissionTime]
type permissionTimeJSON struct {
	Created     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *PermissionTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r permissionTimeJSON) RawJSON() string {
	return r.raw
}

// Union satisfied by [shared.UnionString] or [PermissionPatternArray].
type PermissionPatternUnion interface {
	ImplementsPermissionPatternUnion()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*PermissionPatternUnion)(nil)).Elem(),
		"",
		apijson.UnionVariant{
			TypeFilter: gjson.String,
			Type:       reflect.TypeOf(shared.UnionString("")),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(PermissionPatternArray{}),
		},
	)
}

type PermissionPatternArray []string

func (r PermissionPatternArray) ImplementsPermissionPatternUnion() {}

type SessionPermissionRespondParams struct {
	Response  param.Field[SessionPermissionRespondParamsResponse] `json:"response,required"`
	Directory param.Field[string]                                 `query:"directory"`
}

func (r SessionPermissionRespondParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionPermissionRespondParams]'s query parameters as
// `url.Values`.
func (r SessionPermissionRespondParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionPermissionRespondParamsResponse string

const (
	SessionPermissionRespondParamsResponseOnce   SessionPermissionRespondParamsResponse = "once"
	SessionPermissionRespondParamsResponseAlways SessionPermissionRespondParamsResponse = "always"
	SessionPermissionRespondParamsResponseReject SessionPermissionRespondParamsResponse = "reject"
)

func (r SessionPermissionRespondParamsResponse) IsKnown() bool {
	switch r {
	case SessionPermissionRespondParamsResponseOnce, SessionPermissionRespondParamsResponseAlways, SessionPermissionRespondParamsResponseReject:
		return true
	}
	return false
}
