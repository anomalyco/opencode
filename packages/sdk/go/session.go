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

// SessionService contains methods and other services that help with interacting
// with the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewSessionService] method instead.
type SessionService struct {
	Options     []option.RequestOption
	Permissions *SessionPermissionService
}

// NewSessionService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewSessionService(opts ...option.RequestOption) (r *SessionService) {
	r = &SessionService{}
	r.Options = opts
	r.Permissions = NewSessionPermissionService(opts...)
	return
}

// Create a new session
func (r *SessionService) New(ctx context.Context, params SessionNewParams, opts ...option.RequestOption) (res *Session, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "session"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Update session properties
func (r *SessionService) Update(ctx context.Context, id string, params SessionUpdateParams, opts ...option.RequestOption) (res *Session, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPatch, path, params, &res, opts...)
	return
}

// List all sessions
func (r *SessionService) List(ctx context.Context, query SessionListParams, opts ...option.RequestOption) (res *[]Session, err error) {
	opts = slices.Concat(r.Options, opts)
	path := "session"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Delete a session and all its data
func (r *SessionService) Delete(ctx context.Context, id string, body SessionDeleteParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodDelete, path, body, &res, opts...)
	return
}

// Abort a session
func (r *SessionService) Abort(ctx context.Context, id string, body SessionAbortParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/abort", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Get a session's children
func (r *SessionService) Children(ctx context.Context, id string, query SessionChildrenParams, opts ...option.RequestOption) (res *[]Session, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/children", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Send a new command to a session
func (r *SessionService) Command(ctx context.Context, id string, params SessionCommandParams, opts ...option.RequestOption) (res *SessionCommandResponse, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/command", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Get session
func (r *SessionService) Get(ctx context.Context, id string, query SessionGetParams, opts ...option.RequestOption) (res *Session, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Analyze the app and create an AGENTS.md file
func (r *SessionService) Init(ctx context.Context, id string, params SessionInitParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/init", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Get a message from a session
func (r *SessionService) Message(ctx context.Context, id string, messageID string, query SessionMessageParams, opts ...option.RequestOption) (res *SessionMessageResponse, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	if messageID == "" {
		err = errors.New("missing required messageID parameter")
		return
	}
	path := fmt.Sprintf("session/%s/message/%s", id, messageID)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// List messages for a session
func (r *SessionService) Messages(ctx context.Context, id string, query SessionMessagesParams, opts ...option.RequestOption) (res *[]SessionMessagesResponse, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/message", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, query, &res, opts...)
	return
}

// Create and send a new message to a session
func (r *SessionService) Prompt(ctx context.Context, id string, params SessionPromptParams, opts ...option.RequestOption) (res *SessionPromptResponse, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/message", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Revert a message
func (r *SessionService) Revert(ctx context.Context, id string, params SessionRevertParams, opts ...option.RequestOption) (res *Session, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/revert", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Share a session
func (r *SessionService) Share(ctx context.Context, id string, body SessionShareParams, opts ...option.RequestOption) (res *Session, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/share", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Run a shell command
func (r *SessionService) Shell(ctx context.Context, id string, params SessionShellParams, opts ...option.RequestOption) (res *AssistantMessage, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/shell", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Summarize the session
func (r *SessionService) Summarize(ctx context.Context, id string, params SessionSummarizeParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/summarize", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, params, &res, opts...)
	return
}

// Restore all reverted messages
func (r *SessionService) Unrevert(ctx context.Context, id string, body SessionUnrevertParams, opts ...option.RequestOption) (res *Session, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/unrevert", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Unshare the session
func (r *SessionService) Unshare(ctx context.Context, id string, body SessionUnshareParams, opts ...option.RequestOption) (res *Session, err error) {
	opts = slices.Concat(r.Options, opts)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/share", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodDelete, path, body, &res, opts...)
	return
}

type AgentPart struct {
	ID        string          `json:"id,required"`
	MessageID string          `json:"messageID,required"`
	Name      string          `json:"name,required"`
	SessionID string          `json:"sessionID,required"`
	Type      AgentPartType   `json:"type,required"`
	Source    AgentPartSource `json:"source"`
	JSON      agentPartJSON   `json:"-"`
}

// agentPartJSON contains the JSON metadata for the struct [AgentPart]
type agentPartJSON struct {
	ID          apijson.Field
	MessageID   apijson.Field
	Name        apijson.Field
	SessionID   apijson.Field
	Type        apijson.Field
	Source      apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AgentPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r agentPartJSON) RawJSON() string {
	return r.raw
}

func (r AgentPart) implementsPart() {}

type AgentPartType string

const (
	AgentPartTypeAgent AgentPartType = "agent"
)

func (r AgentPartType) IsKnown() bool {
	switch r {
	case AgentPartTypeAgent:
		return true
	}
	return false
}

type AgentPartSource struct {
	End   int64               `json:"end,required"`
	Start int64               `json:"start,required"`
	Value string              `json:"value,required"`
	JSON  agentPartSourceJSON `json:"-"`
}

// agentPartSourceJSON contains the JSON metadata for the struct [AgentPartSource]
type agentPartSourceJSON struct {
	End         apijson.Field
	Start       apijson.Field
	Value       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AgentPartSource) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r agentPartSourceJSON) RawJSON() string {
	return r.raw
}

type AgentPartInputParam struct {
	Name   param.Field[string]                    `json:"name,required"`
	Type   param.Field[AgentPartInputType]        `json:"type,required"`
	ID     param.Field[string]                    `json:"id"`
	Source param.Field[AgentPartInputSourceParam] `json:"source"`
}

func (r AgentPartInputParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r AgentPartInputParam) implementsSessionPromptParamsPartUnion() {}

type AgentPartInputType string

const (
	AgentPartInputTypeAgent AgentPartInputType = "agent"
)

func (r AgentPartInputType) IsKnown() bool {
	switch r {
	case AgentPartInputTypeAgent:
		return true
	}
	return false
}

type AgentPartInputSourceParam struct {
	End   param.Field[int64]  `json:"end,required"`
	Start param.Field[int64]  `json:"start,required"`
	Value param.Field[string] `json:"value,required"`
}

func (r AgentPartInputSourceParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type AssistantMessage struct {
	ID         string                 `json:"id,required"`
	Cost       float64                `json:"cost,required"`
	Mode       string                 `json:"mode,required"`
	ModelID    string                 `json:"modelID,required"`
	ParentID   string                 `json:"parentID,required"`
	Path       AssistantMessagePath   `json:"path,required"`
	ProviderID string                 `json:"providerID,required"`
	Role       AssistantMessageRole   `json:"role,required"`
	SessionID  string                 `json:"sessionID,required"`
	System     []string               `json:"system,required"`
	Time       AssistantMessageTime   `json:"time,required"`
	Tokens     AssistantMessageTokens `json:"tokens,required"`
	Error      AssistantMessageError  `json:"error"`
	Summary    bool                   `json:"summary"`
	JSON       assistantMessageJSON   `json:"-"`
}

// assistantMessageJSON contains the JSON metadata for the struct
// [AssistantMessage]
type assistantMessageJSON struct {
	ID          apijson.Field
	Cost        apijson.Field
	Mode        apijson.Field
	ModelID     apijson.Field
	ParentID    apijson.Field
	Path        apijson.Field
	ProviderID  apijson.Field
	Role        apijson.Field
	SessionID   apijson.Field
	System      apijson.Field
	Time        apijson.Field
	Tokens      apijson.Field
	Error       apijson.Field
	Summary     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AssistantMessage) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r assistantMessageJSON) RawJSON() string {
	return r.raw
}

func (r AssistantMessage) implementsMessage() {}

type AssistantMessagePath struct {
	Cwd  string                   `json:"cwd,required"`
	Root string                   `json:"root,required"`
	JSON assistantMessagePathJSON `json:"-"`
}

// assistantMessagePathJSON contains the JSON metadata for the struct
// [AssistantMessagePath]
type assistantMessagePathJSON struct {
	Cwd         apijson.Field
	Root        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AssistantMessagePath) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r assistantMessagePathJSON) RawJSON() string {
	return r.raw
}

type AssistantMessageRole string

const (
	AssistantMessageRoleAssistant AssistantMessageRole = "assistant"
)

func (r AssistantMessageRole) IsKnown() bool {
	switch r {
	case AssistantMessageRoleAssistant:
		return true
	}
	return false
}

type AssistantMessageTime struct {
	Created   float64                  `json:"created,required"`
	Completed float64                  `json:"completed"`
	JSON      assistantMessageTimeJSON `json:"-"`
}

// assistantMessageTimeJSON contains the JSON metadata for the struct
// [AssistantMessageTime]
type assistantMessageTimeJSON struct {
	Created     apijson.Field
	Completed   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AssistantMessageTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r assistantMessageTimeJSON) RawJSON() string {
	return r.raw
}

type AssistantMessageTokens struct {
	Cache     AssistantMessageTokensCache `json:"cache,required"`
	Input     float64                     `json:"input,required"`
	Output    float64                     `json:"output,required"`
	Reasoning float64                     `json:"reasoning,required"`
	JSON      assistantMessageTokensJSON  `json:"-"`
}

// assistantMessageTokensJSON contains the JSON metadata for the struct
// [AssistantMessageTokens]
type assistantMessageTokensJSON struct {
	Cache       apijson.Field
	Input       apijson.Field
	Output      apijson.Field
	Reasoning   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AssistantMessageTokens) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r assistantMessageTokensJSON) RawJSON() string {
	return r.raw
}

type AssistantMessageTokensCache struct {
	Read  float64                         `json:"read,required"`
	Write float64                         `json:"write,required"`
	JSON  assistantMessageTokensCacheJSON `json:"-"`
}

// assistantMessageTokensCacheJSON contains the JSON metadata for the struct
// [AssistantMessageTokensCache]
type assistantMessageTokensCacheJSON struct {
	Read        apijson.Field
	Write       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AssistantMessageTokensCache) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r assistantMessageTokensCacheJSON) RawJSON() string {
	return r.raw
}

type AssistantMessageError struct {
	// This field can have the runtime type of [shared.ProviderAuthErrorData],
	// [shared.UnknownErrorData], [interface{}], [shared.MessageAbortedErrorData],
	// [AssistantMessageErrorAPIErrorData].
	Data  interface{}               `json:"data,required"`
	Name  AssistantMessageErrorName `json:"name,required"`
	JSON  assistantMessageErrorJSON `json:"-"`
	union AssistantMessageErrorUnion
}

// assistantMessageErrorJSON contains the JSON metadata for the struct
// [AssistantMessageError]
type assistantMessageErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r assistantMessageErrorJSON) RawJSON() string {
	return r.raw
}

func (r *AssistantMessageError) UnmarshalJSON(data []byte) (err error) {
	*r = AssistantMessageError{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [AssistantMessageErrorUnion] interface which you can cast to
// the specific types for more type safety.
//
// Possible runtime types of the union are [shared.ProviderAuthError],
// [shared.UnknownError], [AssistantMessageErrorMessageOutputLengthError],
// [shared.MessageAbortedError], [AssistantMessageErrorAPIError].
func (r AssistantMessageError) AsUnion() AssistantMessageErrorUnion {
	return r.union
}

// Union satisfied by [shared.ProviderAuthError], [shared.UnknownError],
// [AssistantMessageErrorMessageOutputLengthError], [shared.MessageAbortedError] or
// [AssistantMessageErrorAPIError].
type AssistantMessageErrorUnion interface {
	ImplementsAssistantMessageError()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*AssistantMessageErrorUnion)(nil)).Elem(),
		"",
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(shared.ProviderAuthError{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(shared.UnknownError{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(AssistantMessageErrorMessageOutputLengthError{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(shared.MessageAbortedError{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(AssistantMessageErrorAPIError{}),
		},
	)
}

type AssistantMessageErrorMessageOutputLengthError struct {
	Data interface{}                                       `json:"data,required"`
	Name AssistantMessageErrorMessageOutputLengthErrorName `json:"name,required"`
	JSON assistantMessageErrorMessageOutputLengthErrorJSON `json:"-"`
}

// assistantMessageErrorMessageOutputLengthErrorJSON contains the JSON metadata for
// the struct [AssistantMessageErrorMessageOutputLengthError]
type assistantMessageErrorMessageOutputLengthErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AssistantMessageErrorMessageOutputLengthError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r assistantMessageErrorMessageOutputLengthErrorJSON) RawJSON() string {
	return r.raw
}

func (r AssistantMessageErrorMessageOutputLengthError) ImplementsAssistantMessageError() {}

type AssistantMessageErrorMessageOutputLengthErrorName string

const (
	AssistantMessageErrorMessageOutputLengthErrorNameMessageOutputLengthError AssistantMessageErrorMessageOutputLengthErrorName = "MessageOutputLengthError"
)

func (r AssistantMessageErrorMessageOutputLengthErrorName) IsKnown() bool {
	switch r {
	case AssistantMessageErrorMessageOutputLengthErrorNameMessageOutputLengthError:
		return true
	}
	return false
}

type AssistantMessageErrorAPIError struct {
	Data AssistantMessageErrorAPIErrorData `json:"data,required"`
	Name AssistantMessageErrorAPIErrorName `json:"name,required"`
	JSON assistantMessageErrorAPIErrorJSON `json:"-"`
}

// assistantMessageErrorAPIErrorJSON contains the JSON metadata for the struct
// [AssistantMessageErrorAPIError]
type assistantMessageErrorAPIErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *AssistantMessageErrorAPIError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r assistantMessageErrorAPIErrorJSON) RawJSON() string {
	return r.raw
}

func (r AssistantMessageErrorAPIError) ImplementsAssistantMessageError() {}

type AssistantMessageErrorAPIErrorData struct {
	IsRetryable     bool                                  `json:"isRetryable,required"`
	Message         string                                `json:"message,required"`
	ResponseBody    string                                `json:"responseBody"`
	ResponseHeaders map[string]string                     `json:"responseHeaders"`
	StatusCode      float64                               `json:"statusCode"`
	JSON            assistantMessageErrorAPIErrorDataJSON `json:"-"`
}

// assistantMessageErrorAPIErrorDataJSON contains the JSON metadata for the struct
// [AssistantMessageErrorAPIErrorData]
type assistantMessageErrorAPIErrorDataJSON struct {
	IsRetryable     apijson.Field
	Message         apijson.Field
	ResponseBody    apijson.Field
	ResponseHeaders apijson.Field
	StatusCode      apijson.Field
	raw             string
	ExtraFields     map[string]apijson.Field
}

func (r *AssistantMessageErrorAPIErrorData) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r assistantMessageErrorAPIErrorDataJSON) RawJSON() string {
	return r.raw
}

type AssistantMessageErrorAPIErrorName string

const (
	AssistantMessageErrorAPIErrorNameAPIError AssistantMessageErrorAPIErrorName = "APIError"
)

func (r AssistantMessageErrorAPIErrorName) IsKnown() bool {
	switch r {
	case AssistantMessageErrorAPIErrorNameAPIError:
		return true
	}
	return false
}

type AssistantMessageErrorName string

const (
	AssistantMessageErrorNameProviderAuthError        AssistantMessageErrorName = "ProviderAuthError"
	AssistantMessageErrorNameUnknownError             AssistantMessageErrorName = "UnknownError"
	AssistantMessageErrorNameMessageOutputLengthError AssistantMessageErrorName = "MessageOutputLengthError"
	AssistantMessageErrorNameMessageAbortedError      AssistantMessageErrorName = "MessageAbortedError"
	AssistantMessageErrorNameAPIError                 AssistantMessageErrorName = "APIError"
)

func (r AssistantMessageErrorName) IsKnown() bool {
	switch r {
	case AssistantMessageErrorNameProviderAuthError, AssistantMessageErrorNameUnknownError, AssistantMessageErrorNameMessageOutputLengthError, AssistantMessageErrorNameMessageAbortedError, AssistantMessageErrorNameAPIError:
		return true
	}
	return false
}

type FilePart struct {
	ID        string         `json:"id,required"`
	MessageID string         `json:"messageID,required"`
	Mime      string         `json:"mime,required"`
	SessionID string         `json:"sessionID,required"`
	Type      FilePartType   `json:"type,required"`
	URL       string         `json:"url,required"`
	Filename  string         `json:"filename"`
	Source    FilePartSource `json:"source"`
	JSON      filePartJSON   `json:"-"`
}

// filePartJSON contains the JSON metadata for the struct [FilePart]
type filePartJSON struct {
	ID          apijson.Field
	MessageID   apijson.Field
	Mime        apijson.Field
	SessionID   apijson.Field
	Type        apijson.Field
	URL         apijson.Field
	Filename    apijson.Field
	Source      apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *FilePart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r filePartJSON) RawJSON() string {
	return r.raw
}

func (r FilePart) implementsPart() {}

type FilePartType string

const (
	FilePartTypeFile FilePartType = "file"
)

func (r FilePartType) IsKnown() bool {
	switch r {
	case FilePartTypeFile:
		return true
	}
	return false
}

type FilePartInputParam struct {
	Mime     param.Field[string]                   `json:"mime,required"`
	Type     param.Field[FilePartInputType]        `json:"type,required"`
	URL      param.Field[string]                   `json:"url,required"`
	ID       param.Field[string]                   `json:"id"`
	Filename param.Field[string]                   `json:"filename"`
	Source   param.Field[FilePartSourceUnionParam] `json:"source"`
}

func (r FilePartInputParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r FilePartInputParam) implementsSessionPromptParamsPartUnion() {}

type FilePartInputType string

const (
	FilePartInputTypeFile FilePartInputType = "file"
)

func (r FilePartInputType) IsKnown() bool {
	switch r {
	case FilePartInputTypeFile:
		return true
	}
	return false
}

type FilePartSource struct {
	Path string             `json:"path,required"`
	Text FilePartSourceText `json:"text,required"`
	Type FilePartSourceType `json:"type,required"`
	Kind int64              `json:"kind"`
	Name string             `json:"name"`
	// This field can have the runtime type of [SymbolSourceRange].
	Range interface{}        `json:"range"`
	JSON  filePartSourceJSON `json:"-"`
	union FilePartSourceUnion
}

// filePartSourceJSON contains the JSON metadata for the struct [FilePartSource]
type filePartSourceJSON struct {
	Path        apijson.Field
	Text        apijson.Field
	Type        apijson.Field
	Kind        apijson.Field
	Name        apijson.Field
	Range       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r filePartSourceJSON) RawJSON() string {
	return r.raw
}

func (r *FilePartSource) UnmarshalJSON(data []byte) (err error) {
	*r = FilePartSource{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [FilePartSourceUnion] interface which you can cast to the
// specific types for more type safety.
//
// Possible runtime types of the union are [FileSource], [SymbolSource].
func (r FilePartSource) AsUnion() FilePartSourceUnion {
	return r.union
}

// Union satisfied by [FileSource] or [SymbolSource].
type FilePartSourceUnion interface {
	implementsFilePartSource()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*FilePartSourceUnion)(nil)).Elem(),
		"",
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(FileSource{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(SymbolSource{}),
		},
	)
}

type FilePartSourceType string

const (
	FilePartSourceTypeFile   FilePartSourceType = "file"
	FilePartSourceTypeSymbol FilePartSourceType = "symbol"
)

func (r FilePartSourceType) IsKnown() bool {
	switch r {
	case FilePartSourceTypeFile, FilePartSourceTypeSymbol:
		return true
	}
	return false
}

type FilePartSourceParam struct {
	Path  param.Field[string]                  `json:"path,required"`
	Text  param.Field[FilePartSourceTextParam] `json:"text,required"`
	Type  param.Field[FilePartSourceType]      `json:"type,required"`
	Kind  param.Field[int64]                   `json:"kind"`
	Name  param.Field[string]                  `json:"name"`
	Range param.Field[interface{}]             `json:"range"`
}

func (r FilePartSourceParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r FilePartSourceParam) implementsFilePartSourceUnionParam() {}

// Satisfied by [FileSourceParam], [SymbolSourceParam], [FilePartSourceParam].
type FilePartSourceUnionParam interface {
	implementsFilePartSourceUnionParam()
}

type FilePartSourceText struct {
	End   int64                  `json:"end,required"`
	Start int64                  `json:"start,required"`
	Value string                 `json:"value,required"`
	JSON  filePartSourceTextJSON `json:"-"`
}

// filePartSourceTextJSON contains the JSON metadata for the struct
// [FilePartSourceText]
type filePartSourceTextJSON struct {
	End         apijson.Field
	Start       apijson.Field
	Value       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *FilePartSourceText) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r filePartSourceTextJSON) RawJSON() string {
	return r.raw
}

type FilePartSourceTextParam struct {
	End   param.Field[int64]  `json:"end,required"`
	Start param.Field[int64]  `json:"start,required"`
	Value param.Field[string] `json:"value,required"`
}

func (r FilePartSourceTextParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type FileSource struct {
	Path string             `json:"path,required"`
	Text FilePartSourceText `json:"text,required"`
	Type FileSourceType     `json:"type,required"`
	JSON fileSourceJSON     `json:"-"`
}

// fileSourceJSON contains the JSON metadata for the struct [FileSource]
type fileSourceJSON struct {
	Path        apijson.Field
	Text        apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *FileSource) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r fileSourceJSON) RawJSON() string {
	return r.raw
}

func (r FileSource) implementsFilePartSource() {}

type FileSourceType string

const (
	FileSourceTypeFile FileSourceType = "file"
)

func (r FileSourceType) IsKnown() bool {
	switch r {
	case FileSourceTypeFile:
		return true
	}
	return false
}

type FileSourceParam struct {
	Path param.Field[string]                  `json:"path,required"`
	Text param.Field[FilePartSourceTextParam] `json:"text,required"`
	Type param.Field[FileSourceType]          `json:"type,required"`
}

func (r FileSourceParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r FileSourceParam) implementsFilePartSourceUnionParam() {}

type Message struct {
	ID        string      `json:"id,required"`
	Role      MessageRole `json:"role,required"`
	SessionID string      `json:"sessionID,required"`
	// This field can have the runtime type of [UserMessageTime],
	// [AssistantMessageTime].
	Time interface{} `json:"time,required"`
	Cost float64     `json:"cost"`
	// This field can have the runtime type of [AssistantMessageError].
	Error    interface{} `json:"error"`
	Mode     string      `json:"mode"`
	ModelID  string      `json:"modelID"`
	ParentID string      `json:"parentID"`
	// This field can have the runtime type of [AssistantMessagePath].
	Path       interface{} `json:"path"`
	ProviderID string      `json:"providerID"`
	// This field can have the runtime type of [UserMessageSummary], [bool].
	Summary interface{} `json:"summary"`
	// This field can have the runtime type of [[]string].
	System interface{} `json:"system"`
	// This field can have the runtime type of [AssistantMessageTokens].
	Tokens interface{} `json:"tokens"`
	JSON   messageJSON `json:"-"`
	union  MessageUnion
}

// messageJSON contains the JSON metadata for the struct [Message]
type messageJSON struct {
	ID          apijson.Field
	Role        apijson.Field
	SessionID   apijson.Field
	Time        apijson.Field
	Cost        apijson.Field
	Error       apijson.Field
	Mode        apijson.Field
	ModelID     apijson.Field
	ParentID    apijson.Field
	Path        apijson.Field
	ProviderID  apijson.Field
	Summary     apijson.Field
	System      apijson.Field
	Tokens      apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r messageJSON) RawJSON() string {
	return r.raw
}

func (r *Message) UnmarshalJSON(data []byte) (err error) {
	*r = Message{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [MessageUnion] interface which you can cast to the specific
// types for more type safety.
//
// Possible runtime types of the union are [UserMessage], [AssistantMessage].
func (r Message) AsUnion() MessageUnion {
	return r.union
}

// Union satisfied by [UserMessage] or [AssistantMessage].
type MessageUnion interface {
	implementsMessage()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*MessageUnion)(nil)).Elem(),
		"",
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(UserMessage{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(AssistantMessage{}),
		},
	)
}

type MessageRole string

const (
	MessageRoleUser      MessageRole = "user"
	MessageRoleAssistant MessageRole = "assistant"
)

func (r MessageRole) IsKnown() bool {
	switch r {
	case MessageRoleUser, MessageRoleAssistant:
		return true
	}
	return false
}

type Part struct {
	ID        string   `json:"id,required"`
	MessageID string   `json:"messageID,required"`
	SessionID string   `json:"sessionID,required"`
	Type      PartType `json:"type,required"`
	Attempt   float64  `json:"attempt"`
	CallID    string   `json:"callID"`
	Cost      float64  `json:"cost"`
	// This field can have the runtime type of [PartRetryPartError].
	Error    interface{} `json:"error"`
	Filename string      `json:"filename"`
	// This field can have the runtime type of [[]string].
	Files interface{} `json:"files"`
	Hash  string      `json:"hash"`
	// This field can have the runtime type of [map[string]interface{}].
	Metadata interface{} `json:"metadata"`
	Mime     string      `json:"mime"`
	Name     string      `json:"name"`
	Reason   string      `json:"reason"`
	Snapshot string      `json:"snapshot"`
	// This field can have the runtime type of [FilePartSource], [AgentPartSource].
	Source interface{} `json:"source"`
	// This field can have the runtime type of [ToolPartState].
	State     interface{} `json:"state"`
	Synthetic bool        `json:"synthetic"`
	Text      string      `json:"text"`
	// This field can have the runtime type of [TextPartTime], [ReasoningPartTime],
	// [PartRetryPartTime].
	Time interface{} `json:"time"`
	// This field can have the runtime type of [StepFinishPartTokens].
	Tokens interface{} `json:"tokens"`
	Tool   string      `json:"tool"`
	URL    string      `json:"url"`
	JSON   partJSON    `json:"-"`
	union  PartUnion
}

// partJSON contains the JSON metadata for the struct [Part]
type partJSON struct {
	ID          apijson.Field
	MessageID   apijson.Field
	SessionID   apijson.Field
	Type        apijson.Field
	Attempt     apijson.Field
	CallID      apijson.Field
	Cost        apijson.Field
	Error       apijson.Field
	Filename    apijson.Field
	Files       apijson.Field
	Hash        apijson.Field
	Metadata    apijson.Field
	Mime        apijson.Field
	Name        apijson.Field
	Reason      apijson.Field
	Snapshot    apijson.Field
	Source      apijson.Field
	State       apijson.Field
	Synthetic   apijson.Field
	Text        apijson.Field
	Time        apijson.Field
	Tokens      apijson.Field
	Tool        apijson.Field
	URL         apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r partJSON) RawJSON() string {
	return r.raw
}

func (r *Part) UnmarshalJSON(data []byte) (err error) {
	*r = Part{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [PartUnion] interface which you can cast to the specific types
// for more type safety.
//
// Possible runtime types of the union are [TextPart], [ReasoningPart], [FilePart],
// [ToolPart], [StepStartPart], [StepFinishPart], [SnapshotPart], [PartPatchPart],
// [AgentPart], [PartRetryPart].
func (r Part) AsUnion() PartUnion {
	return r.union
}

// Union satisfied by [TextPart], [ReasoningPart], [FilePart], [ToolPart],
// [StepStartPart], [StepFinishPart], [SnapshotPart], [PartPatchPart], [AgentPart]
// or [PartRetryPart].
type PartUnion interface {
	implementsPart()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*PartUnion)(nil)).Elem(),
		"",
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(TextPart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(ReasoningPart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(FilePart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(ToolPart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(StepStartPart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(StepFinishPart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(SnapshotPart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(PartPatchPart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(AgentPart{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(PartRetryPart{}),
		},
	)
}

type PartPatchPart struct {
	ID        string            `json:"id,required"`
	Files     []string          `json:"files,required"`
	Hash      string            `json:"hash,required"`
	MessageID string            `json:"messageID,required"`
	SessionID string            `json:"sessionID,required"`
	Type      PartPatchPartType `json:"type,required"`
	JSON      partPatchPartJSON `json:"-"`
}

// partPatchPartJSON contains the JSON metadata for the struct [PartPatchPart]
type partPatchPartJSON struct {
	ID          apijson.Field
	Files       apijson.Field
	Hash        apijson.Field
	MessageID   apijson.Field
	SessionID   apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *PartPatchPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r partPatchPartJSON) RawJSON() string {
	return r.raw
}

func (r PartPatchPart) implementsPart() {}

type PartPatchPartType string

const (
	PartPatchPartTypePatch PartPatchPartType = "patch"
)

func (r PartPatchPartType) IsKnown() bool {
	switch r {
	case PartPatchPartTypePatch:
		return true
	}
	return false
}

type PartRetryPart struct {
	ID        string             `json:"id,required"`
	Attempt   float64            `json:"attempt,required"`
	Error     PartRetryPartError `json:"error,required"`
	MessageID string             `json:"messageID,required"`
	SessionID string             `json:"sessionID,required"`
	Time      PartRetryPartTime  `json:"time,required"`
	Type      PartRetryPartType  `json:"type,required"`
	JSON      partRetryPartJSON  `json:"-"`
}

// partRetryPartJSON contains the JSON metadata for the struct [PartRetryPart]
type partRetryPartJSON struct {
	ID          apijson.Field
	Attempt     apijson.Field
	Error       apijson.Field
	MessageID   apijson.Field
	SessionID   apijson.Field
	Time        apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *PartRetryPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r partRetryPartJSON) RawJSON() string {
	return r.raw
}

func (r PartRetryPart) implementsPart() {}

type PartRetryPartError struct {
	Data PartRetryPartErrorData `json:"data,required"`
	Name PartRetryPartErrorName `json:"name,required"`
	JSON partRetryPartErrorJSON `json:"-"`
}

// partRetryPartErrorJSON contains the JSON metadata for the struct
// [PartRetryPartError]
type partRetryPartErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *PartRetryPartError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r partRetryPartErrorJSON) RawJSON() string {
	return r.raw
}

type PartRetryPartErrorData struct {
	IsRetryable     bool                       `json:"isRetryable,required"`
	Message         string                     `json:"message,required"`
	ResponseBody    string                     `json:"responseBody"`
	ResponseHeaders map[string]string          `json:"responseHeaders"`
	StatusCode      float64                    `json:"statusCode"`
	JSON            partRetryPartErrorDataJSON `json:"-"`
}

// partRetryPartErrorDataJSON contains the JSON metadata for the struct
// [PartRetryPartErrorData]
type partRetryPartErrorDataJSON struct {
	IsRetryable     apijson.Field
	Message         apijson.Field
	ResponseBody    apijson.Field
	ResponseHeaders apijson.Field
	StatusCode      apijson.Field
	raw             string
	ExtraFields     map[string]apijson.Field
}

func (r *PartRetryPartErrorData) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r partRetryPartErrorDataJSON) RawJSON() string {
	return r.raw
}

type PartRetryPartErrorName string

const (
	PartRetryPartErrorNameAPIError PartRetryPartErrorName = "APIError"
)

func (r PartRetryPartErrorName) IsKnown() bool {
	switch r {
	case PartRetryPartErrorNameAPIError:
		return true
	}
	return false
}

type PartRetryPartTime struct {
	Created float64               `json:"created,required"`
	JSON    partRetryPartTimeJSON `json:"-"`
}

// partRetryPartTimeJSON contains the JSON metadata for the struct
// [PartRetryPartTime]
type partRetryPartTimeJSON struct {
	Created     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *PartRetryPartTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r partRetryPartTimeJSON) RawJSON() string {
	return r.raw
}

type PartRetryPartType string

const (
	PartRetryPartTypeRetry PartRetryPartType = "retry"
)

func (r PartRetryPartType) IsKnown() bool {
	switch r {
	case PartRetryPartTypeRetry:
		return true
	}
	return false
}

type PartType string

const (
	PartTypeText       PartType = "text"
	PartTypeReasoning  PartType = "reasoning"
	PartTypeFile       PartType = "file"
	PartTypeTool       PartType = "tool"
	PartTypeStepStart  PartType = "step-start"
	PartTypeStepFinish PartType = "step-finish"
	PartTypeSnapshot   PartType = "snapshot"
	PartTypePatch      PartType = "patch"
	PartTypeAgent      PartType = "agent"
	PartTypeRetry      PartType = "retry"
)

func (r PartType) IsKnown() bool {
	switch r {
	case PartTypeText, PartTypeReasoning, PartTypeFile, PartTypeTool, PartTypeStepStart, PartTypeStepFinish, PartTypeSnapshot, PartTypePatch, PartTypeAgent, PartTypeRetry:
		return true
	}
	return false
}

type ReasoningPart struct {
	ID        string                 `json:"id,required"`
	MessageID string                 `json:"messageID,required"`
	SessionID string                 `json:"sessionID,required"`
	Text      string                 `json:"text,required"`
	Time      ReasoningPartTime      `json:"time,required"`
	Type      ReasoningPartType      `json:"type,required"`
	Metadata  map[string]interface{} `json:"metadata"`
	JSON      reasoningPartJSON      `json:"-"`
}

// reasoningPartJSON contains the JSON metadata for the struct [ReasoningPart]
type reasoningPartJSON struct {
	ID          apijson.Field
	MessageID   apijson.Field
	SessionID   apijson.Field
	Text        apijson.Field
	Time        apijson.Field
	Type        apijson.Field
	Metadata    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ReasoningPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r reasoningPartJSON) RawJSON() string {
	return r.raw
}

func (r ReasoningPart) implementsPart() {}

type ReasoningPartTime struct {
	Start float64               `json:"start,required"`
	End   float64               `json:"end"`
	JSON  reasoningPartTimeJSON `json:"-"`
}

// reasoningPartTimeJSON contains the JSON metadata for the struct
// [ReasoningPartTime]
type reasoningPartTimeJSON struct {
	Start       apijson.Field
	End         apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ReasoningPartTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r reasoningPartTimeJSON) RawJSON() string {
	return r.raw
}

type ReasoningPartType string

const (
	ReasoningPartTypeReasoning ReasoningPartType = "reasoning"
)

func (r ReasoningPartType) IsKnown() bool {
	switch r {
	case ReasoningPartTypeReasoning:
		return true
	}
	return false
}

type Session struct {
	ID        string         `json:"id,required"`
	Directory string         `json:"directory,required"`
	ProjectID string         `json:"projectID,required"`
	Time      SessionTime    `json:"time,required"`
	Title     string         `json:"title,required"`
	Version   string         `json:"version,required"`
	ParentID  string         `json:"parentID"`
	Revert    SessionRevert  `json:"revert"`
	Share     SessionShare   `json:"share"`
	Summary   SessionSummary `json:"summary"`
	JSON      sessionJSON    `json:"-"`
}

// sessionJSON contains the JSON metadata for the struct [Session]
type sessionJSON struct {
	ID          apijson.Field
	Directory   apijson.Field
	ProjectID   apijson.Field
	Time        apijson.Field
	Title       apijson.Field
	Version     apijson.Field
	ParentID    apijson.Field
	Revert      apijson.Field
	Share       apijson.Field
	Summary     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Session) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionJSON) RawJSON() string {
	return r.raw
}

type SessionTime struct {
	Created    float64         `json:"created,required"`
	Updated    float64         `json:"updated,required"`
	Compacting float64         `json:"compacting"`
	JSON       sessionTimeJSON `json:"-"`
}

// sessionTimeJSON contains the JSON metadata for the struct [SessionTime]
type sessionTimeJSON struct {
	Created     apijson.Field
	Updated     apijson.Field
	Compacting  apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionTimeJSON) RawJSON() string {
	return r.raw
}

type SessionRevert struct {
	MessageID string            `json:"messageID,required"`
	Diff      string            `json:"diff"`
	PartID    string            `json:"partID"`
	Snapshot  string            `json:"snapshot"`
	JSON      sessionRevertJSON `json:"-"`
}

// sessionRevertJSON contains the JSON metadata for the struct [SessionRevert]
type sessionRevertJSON struct {
	MessageID   apijson.Field
	Diff        apijson.Field
	PartID      apijson.Field
	Snapshot    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionRevert) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionRevertJSON) RawJSON() string {
	return r.raw
}

type SessionShare struct {
	URL  string           `json:"url,required"`
	JSON sessionShareJSON `json:"-"`
}

// sessionShareJSON contains the JSON metadata for the struct [SessionShare]
type sessionShareJSON struct {
	URL         apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionShare) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionShareJSON) RawJSON() string {
	return r.raw
}

type SessionSummary struct {
	Diffs []SessionSummaryDiff `json:"diffs,required"`
	JSON  sessionSummaryJSON   `json:"-"`
}

// sessionSummaryJSON contains the JSON metadata for the struct [SessionSummary]
type sessionSummaryJSON struct {
	Diffs       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionSummary) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionSummaryJSON) RawJSON() string {
	return r.raw
}

type SessionSummaryDiff struct {
	Additions float64                `json:"additions,required"`
	After     string                 `json:"after,required"`
	Before    string                 `json:"before,required"`
	Deletions float64                `json:"deletions,required"`
	File      string                 `json:"file,required"`
	JSON      sessionSummaryDiffJSON `json:"-"`
}

// sessionSummaryDiffJSON contains the JSON metadata for the struct
// [SessionSummaryDiff]
type sessionSummaryDiffJSON struct {
	Additions   apijson.Field
	After       apijson.Field
	Before      apijson.Field
	Deletions   apijson.Field
	File        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionSummaryDiff) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionSummaryDiffJSON) RawJSON() string {
	return r.raw
}

type SnapshotPart struct {
	ID        string           `json:"id,required"`
	MessageID string           `json:"messageID,required"`
	SessionID string           `json:"sessionID,required"`
	Snapshot  string           `json:"snapshot,required"`
	Type      SnapshotPartType `json:"type,required"`
	JSON      snapshotPartJSON `json:"-"`
}

// snapshotPartJSON contains the JSON metadata for the struct [SnapshotPart]
type snapshotPartJSON struct {
	ID          apijson.Field
	MessageID   apijson.Field
	SessionID   apijson.Field
	Snapshot    apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SnapshotPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r snapshotPartJSON) RawJSON() string {
	return r.raw
}

func (r SnapshotPart) implementsPart() {}

type SnapshotPartType string

const (
	SnapshotPartTypeSnapshot SnapshotPartType = "snapshot"
)

func (r SnapshotPartType) IsKnown() bool {
	switch r {
	case SnapshotPartTypeSnapshot:
		return true
	}
	return false
}

type StepFinishPart struct {
	ID        string               `json:"id,required"`
	Cost      float64              `json:"cost,required"`
	MessageID string               `json:"messageID,required"`
	Reason    string               `json:"reason,required"`
	SessionID string               `json:"sessionID,required"`
	Tokens    StepFinishPartTokens `json:"tokens,required"`
	Type      StepFinishPartType   `json:"type,required"`
	Snapshot  string               `json:"snapshot"`
	JSON      stepFinishPartJSON   `json:"-"`
}

// stepFinishPartJSON contains the JSON metadata for the struct [StepFinishPart]
type stepFinishPartJSON struct {
	ID          apijson.Field
	Cost        apijson.Field
	MessageID   apijson.Field
	Reason      apijson.Field
	SessionID   apijson.Field
	Tokens      apijson.Field
	Type        apijson.Field
	Snapshot    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *StepFinishPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r stepFinishPartJSON) RawJSON() string {
	return r.raw
}

func (r StepFinishPart) implementsPart() {}

type StepFinishPartTokens struct {
	Cache     StepFinishPartTokensCache `json:"cache,required"`
	Input     float64                   `json:"input,required"`
	Output    float64                   `json:"output,required"`
	Reasoning float64                   `json:"reasoning,required"`
	JSON      stepFinishPartTokensJSON  `json:"-"`
}

// stepFinishPartTokensJSON contains the JSON metadata for the struct
// [StepFinishPartTokens]
type stepFinishPartTokensJSON struct {
	Cache       apijson.Field
	Input       apijson.Field
	Output      apijson.Field
	Reasoning   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *StepFinishPartTokens) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r stepFinishPartTokensJSON) RawJSON() string {
	return r.raw
}

type StepFinishPartTokensCache struct {
	Read  float64                       `json:"read,required"`
	Write float64                       `json:"write,required"`
	JSON  stepFinishPartTokensCacheJSON `json:"-"`
}

// stepFinishPartTokensCacheJSON contains the JSON metadata for the struct
// [StepFinishPartTokensCache]
type stepFinishPartTokensCacheJSON struct {
	Read        apijson.Field
	Write       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *StepFinishPartTokensCache) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r stepFinishPartTokensCacheJSON) RawJSON() string {
	return r.raw
}

type StepFinishPartType string

const (
	StepFinishPartTypeStepFinish StepFinishPartType = "step-finish"
)

func (r StepFinishPartType) IsKnown() bool {
	switch r {
	case StepFinishPartTypeStepFinish:
		return true
	}
	return false
}

type StepStartPart struct {
	ID        string            `json:"id,required"`
	MessageID string            `json:"messageID,required"`
	SessionID string            `json:"sessionID,required"`
	Type      StepStartPartType `json:"type,required"`
	Snapshot  string            `json:"snapshot"`
	JSON      stepStartPartJSON `json:"-"`
}

// stepStartPartJSON contains the JSON metadata for the struct [StepStartPart]
type stepStartPartJSON struct {
	ID          apijson.Field
	MessageID   apijson.Field
	SessionID   apijson.Field
	Type        apijson.Field
	Snapshot    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *StepStartPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r stepStartPartJSON) RawJSON() string {
	return r.raw
}

func (r StepStartPart) implementsPart() {}

type StepStartPartType string

const (
	StepStartPartTypeStepStart StepStartPartType = "step-start"
)

func (r StepStartPartType) IsKnown() bool {
	switch r {
	case StepStartPartTypeStepStart:
		return true
	}
	return false
}

type SymbolSource struct {
	Kind  int64              `json:"kind,required"`
	Name  string             `json:"name,required"`
	Path  string             `json:"path,required"`
	Range SymbolSourceRange  `json:"range,required"`
	Text  FilePartSourceText `json:"text,required"`
	Type  SymbolSourceType   `json:"type,required"`
	JSON  symbolSourceJSON   `json:"-"`
}

// symbolSourceJSON contains the JSON metadata for the struct [SymbolSource]
type symbolSourceJSON struct {
	Kind        apijson.Field
	Name        apijson.Field
	Path        apijson.Field
	Range       apijson.Field
	Text        apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SymbolSource) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolSourceJSON) RawJSON() string {
	return r.raw
}

func (r SymbolSource) implementsFilePartSource() {}

type SymbolSourceRange struct {
	End   SymbolSourceRangeEnd   `json:"end,required"`
	Start SymbolSourceRangeStart `json:"start,required"`
	JSON  symbolSourceRangeJSON  `json:"-"`
}

// symbolSourceRangeJSON contains the JSON metadata for the struct
// [SymbolSourceRange]
type symbolSourceRangeJSON struct {
	End         apijson.Field
	Start       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SymbolSourceRange) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolSourceRangeJSON) RawJSON() string {
	return r.raw
}

type SymbolSourceRangeEnd struct {
	Character float64                  `json:"character,required"`
	Line      float64                  `json:"line,required"`
	JSON      symbolSourceRangeEndJSON `json:"-"`
}

// symbolSourceRangeEndJSON contains the JSON metadata for the struct
// [SymbolSourceRangeEnd]
type symbolSourceRangeEndJSON struct {
	Character   apijson.Field
	Line        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SymbolSourceRangeEnd) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolSourceRangeEndJSON) RawJSON() string {
	return r.raw
}

type SymbolSourceRangeStart struct {
	Character float64                    `json:"character,required"`
	Line      float64                    `json:"line,required"`
	JSON      symbolSourceRangeStartJSON `json:"-"`
}

// symbolSourceRangeStartJSON contains the JSON metadata for the struct
// [SymbolSourceRangeStart]
type symbolSourceRangeStartJSON struct {
	Character   apijson.Field
	Line        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SymbolSourceRangeStart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r symbolSourceRangeStartJSON) RawJSON() string {
	return r.raw
}

type SymbolSourceType string

const (
	SymbolSourceTypeSymbol SymbolSourceType = "symbol"
)

func (r SymbolSourceType) IsKnown() bool {
	switch r {
	case SymbolSourceTypeSymbol:
		return true
	}
	return false
}

type SymbolSourceParam struct {
	Kind  param.Field[int64]                   `json:"kind,required"`
	Name  param.Field[string]                  `json:"name,required"`
	Path  param.Field[string]                  `json:"path,required"`
	Range param.Field[SymbolSourceRangeParam]  `json:"range,required"`
	Text  param.Field[FilePartSourceTextParam] `json:"text,required"`
	Type  param.Field[SymbolSourceType]        `json:"type,required"`
}

func (r SymbolSourceParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r SymbolSourceParam) implementsFilePartSourceUnionParam() {}

type SymbolSourceRangeParam struct {
	End   param.Field[SymbolSourceRangeEndParam]   `json:"end,required"`
	Start param.Field[SymbolSourceRangeStartParam] `json:"start,required"`
}

func (r SymbolSourceRangeParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type SymbolSourceRangeEndParam struct {
	Character param.Field[float64] `json:"character,required"`
	Line      param.Field[float64] `json:"line,required"`
}

func (r SymbolSourceRangeEndParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type SymbolSourceRangeStartParam struct {
	Character param.Field[float64] `json:"character,required"`
	Line      param.Field[float64] `json:"line,required"`
}

func (r SymbolSourceRangeStartParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type TextPart struct {
	ID        string                 `json:"id,required"`
	MessageID string                 `json:"messageID,required"`
	SessionID string                 `json:"sessionID,required"`
	Text      string                 `json:"text,required"`
	Type      TextPartType           `json:"type,required"`
	Metadata  map[string]interface{} `json:"metadata"`
	Synthetic bool                   `json:"synthetic"`
	Time      TextPartTime           `json:"time"`
	JSON      textPartJSON           `json:"-"`
}

// textPartJSON contains the JSON metadata for the struct [TextPart]
type textPartJSON struct {
	ID          apijson.Field
	MessageID   apijson.Field
	SessionID   apijson.Field
	Text        apijson.Field
	Type        apijson.Field
	Metadata    apijson.Field
	Synthetic   apijson.Field
	Time        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *TextPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r textPartJSON) RawJSON() string {
	return r.raw
}

func (r TextPart) implementsPart() {}

type TextPartType string

const (
	TextPartTypeText TextPartType = "text"
)

func (r TextPartType) IsKnown() bool {
	switch r {
	case TextPartTypeText:
		return true
	}
	return false
}

type TextPartTime struct {
	Start float64          `json:"start,required"`
	End   float64          `json:"end"`
	JSON  textPartTimeJSON `json:"-"`
}

// textPartTimeJSON contains the JSON metadata for the struct [TextPartTime]
type textPartTimeJSON struct {
	Start       apijson.Field
	End         apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *TextPartTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r textPartTimeJSON) RawJSON() string {
	return r.raw
}

type TextPartInputParam struct {
	Text      param.Field[string]                 `json:"text,required"`
	Type      param.Field[TextPartInputType]      `json:"type,required"`
	ID        param.Field[string]                 `json:"id"`
	Metadata  param.Field[map[string]interface{}] `json:"metadata"`
	Synthetic param.Field[bool]                   `json:"synthetic"`
	Time      param.Field[TextPartInputTimeParam] `json:"time"`
}

func (r TextPartInputParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r TextPartInputParam) implementsSessionPromptParamsPartUnion() {}

type TextPartInputType string

const (
	TextPartInputTypeText TextPartInputType = "text"
)

func (r TextPartInputType) IsKnown() bool {
	switch r {
	case TextPartInputTypeText:
		return true
	}
	return false
}

type TextPartInputTimeParam struct {
	Start param.Field[float64] `json:"start,required"`
	End   param.Field[float64] `json:"end"`
}

func (r TextPartInputTimeParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type ToolPart struct {
	ID        string                 `json:"id,required"`
	CallID    string                 `json:"callID,required"`
	MessageID string                 `json:"messageID,required"`
	SessionID string                 `json:"sessionID,required"`
	State     ToolPartState          `json:"state,required"`
	Tool      string                 `json:"tool,required"`
	Type      ToolPartType           `json:"type,required"`
	Metadata  map[string]interface{} `json:"metadata"`
	JSON      toolPartJSON           `json:"-"`
}

// toolPartJSON contains the JSON metadata for the struct [ToolPart]
type toolPartJSON struct {
	ID          apijson.Field
	CallID      apijson.Field
	MessageID   apijson.Field
	SessionID   apijson.Field
	State       apijson.Field
	Tool        apijson.Field
	Type        apijson.Field
	Metadata    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolPartJSON) RawJSON() string {
	return r.raw
}

func (r ToolPart) implementsPart() {}

type ToolPartState struct {
	Status ToolPartStateStatus `json:"status,required"`
	// This field can have the runtime type of [[]FilePart].
	Attachments interface{} `json:"attachments"`
	Error       string      `json:"error"`
	// This field can have the runtime type of [interface{}], [map[string]interface{}].
	Input interface{} `json:"input"`
	// This field can have the runtime type of [map[string]interface{}].
	Metadata interface{} `json:"metadata"`
	Output   string      `json:"output"`
	// This field can have the runtime type of [ToolStateRunningTime],
	// [ToolStateCompletedTime], [ToolStateErrorTime].
	Time  interface{}       `json:"time"`
	Title string            `json:"title"`
	JSON  toolPartStateJSON `json:"-"`
	union ToolPartStateUnion
}

// toolPartStateJSON contains the JSON metadata for the struct [ToolPartState]
type toolPartStateJSON struct {
	Status      apijson.Field
	Attachments apijson.Field
	Error       apijson.Field
	Input       apijson.Field
	Metadata    apijson.Field
	Output      apijson.Field
	Time        apijson.Field
	Title       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r toolPartStateJSON) RawJSON() string {
	return r.raw
}

func (r *ToolPartState) UnmarshalJSON(data []byte) (err error) {
	*r = ToolPartState{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [ToolPartStateUnion] interface which you can cast to the
// specific types for more type safety.
//
// Possible runtime types of the union are [ToolStatePending], [ToolStateRunning],
// [ToolStateCompleted], [ToolStateError].
func (r ToolPartState) AsUnion() ToolPartStateUnion {
	return r.union
}

// Union satisfied by [ToolStatePending], [ToolStateRunning], [ToolStateCompleted]
// or [ToolStateError].
type ToolPartStateUnion interface {
	implementsToolPartState()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*ToolPartStateUnion)(nil)).Elem(),
		"",
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(ToolStatePending{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(ToolStateRunning{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(ToolStateCompleted{}),
		},
		apijson.UnionVariant{
			TypeFilter: gjson.JSON,
			Type:       reflect.TypeOf(ToolStateError{}),
		},
	)
}

type ToolPartStateStatus string

const (
	ToolPartStateStatusPending   ToolPartStateStatus = "pending"
	ToolPartStateStatusRunning   ToolPartStateStatus = "running"
	ToolPartStateStatusCompleted ToolPartStateStatus = "completed"
	ToolPartStateStatusError     ToolPartStateStatus = "error"
)

func (r ToolPartStateStatus) IsKnown() bool {
	switch r {
	case ToolPartStateStatusPending, ToolPartStateStatusRunning, ToolPartStateStatusCompleted, ToolPartStateStatusError:
		return true
	}
	return false
}

type ToolPartType string

const (
	ToolPartTypeTool ToolPartType = "tool"
)

func (r ToolPartType) IsKnown() bool {
	switch r {
	case ToolPartTypeTool:
		return true
	}
	return false
}

type ToolStateCompleted struct {
	Input       map[string]interface{}   `json:"input,required"`
	Metadata    map[string]interface{}   `json:"metadata,required"`
	Output      string                   `json:"output,required"`
	Status      ToolStateCompletedStatus `json:"status,required"`
	Time        ToolStateCompletedTime   `json:"time,required"`
	Title       string                   `json:"title,required"`
	Attachments []FilePart               `json:"attachments"`
	JSON        toolStateCompletedJSON   `json:"-"`
}

// toolStateCompletedJSON contains the JSON metadata for the struct
// [ToolStateCompleted]
type toolStateCompletedJSON struct {
	Input       apijson.Field
	Metadata    apijson.Field
	Output      apijson.Field
	Status      apijson.Field
	Time        apijson.Field
	Title       apijson.Field
	Attachments apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolStateCompleted) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolStateCompletedJSON) RawJSON() string {
	return r.raw
}

func (r ToolStateCompleted) implementsToolPartState() {}

type ToolStateCompletedStatus string

const (
	ToolStateCompletedStatusCompleted ToolStateCompletedStatus = "completed"
)

func (r ToolStateCompletedStatus) IsKnown() bool {
	switch r {
	case ToolStateCompletedStatusCompleted:
		return true
	}
	return false
}

type ToolStateCompletedTime struct {
	End       float64                    `json:"end,required"`
	Start     float64                    `json:"start,required"`
	Compacted float64                    `json:"compacted"`
	JSON      toolStateCompletedTimeJSON `json:"-"`
}

// toolStateCompletedTimeJSON contains the JSON metadata for the struct
// [ToolStateCompletedTime]
type toolStateCompletedTimeJSON struct {
	End         apijson.Field
	Start       apijson.Field
	Compacted   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolStateCompletedTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolStateCompletedTimeJSON) RawJSON() string {
	return r.raw
}

type ToolStateError struct {
	Error    string                 `json:"error,required"`
	Input    map[string]interface{} `json:"input,required"`
	Status   ToolStateErrorStatus   `json:"status,required"`
	Time     ToolStateErrorTime     `json:"time,required"`
	Metadata map[string]interface{} `json:"metadata"`
	JSON     toolStateErrorJSON     `json:"-"`
}

// toolStateErrorJSON contains the JSON metadata for the struct [ToolStateError]
type toolStateErrorJSON struct {
	Error       apijson.Field
	Input       apijson.Field
	Status      apijson.Field
	Time        apijson.Field
	Metadata    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolStateError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolStateErrorJSON) RawJSON() string {
	return r.raw
}

func (r ToolStateError) implementsToolPartState() {}

type ToolStateErrorStatus string

const (
	ToolStateErrorStatusError ToolStateErrorStatus = "error"
)

func (r ToolStateErrorStatus) IsKnown() bool {
	switch r {
	case ToolStateErrorStatusError:
		return true
	}
	return false
}

type ToolStateErrorTime struct {
	End   float64                `json:"end,required"`
	Start float64                `json:"start,required"`
	JSON  toolStateErrorTimeJSON `json:"-"`
}

// toolStateErrorTimeJSON contains the JSON metadata for the struct
// [ToolStateErrorTime]
type toolStateErrorTimeJSON struct {
	End         apijson.Field
	Start       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolStateErrorTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolStateErrorTimeJSON) RawJSON() string {
	return r.raw
}

type ToolStatePending struct {
	Status ToolStatePendingStatus `json:"status,required"`
	JSON   toolStatePendingJSON   `json:"-"`
}

// toolStatePendingJSON contains the JSON metadata for the struct
// [ToolStatePending]
type toolStatePendingJSON struct {
	Status      apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolStatePending) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolStatePendingJSON) RawJSON() string {
	return r.raw
}

func (r ToolStatePending) implementsToolPartState() {}

type ToolStatePendingStatus string

const (
	ToolStatePendingStatusPending ToolStatePendingStatus = "pending"
)

func (r ToolStatePendingStatus) IsKnown() bool {
	switch r {
	case ToolStatePendingStatusPending:
		return true
	}
	return false
}

type ToolStateRunning struct {
	Input    interface{}            `json:"input,required"`
	Status   ToolStateRunningStatus `json:"status,required"`
	Time     ToolStateRunningTime   `json:"time,required"`
	Metadata map[string]interface{} `json:"metadata"`
	Title    string                 `json:"title"`
	JSON     toolStateRunningJSON   `json:"-"`
}

// toolStateRunningJSON contains the JSON metadata for the struct
// [ToolStateRunning]
type toolStateRunningJSON struct {
	Input       apijson.Field
	Status      apijson.Field
	Time        apijson.Field
	Metadata    apijson.Field
	Title       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolStateRunning) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolStateRunningJSON) RawJSON() string {
	return r.raw
}

func (r ToolStateRunning) implementsToolPartState() {}

type ToolStateRunningStatus string

const (
	ToolStateRunningStatusRunning ToolStateRunningStatus = "running"
)

func (r ToolStateRunningStatus) IsKnown() bool {
	switch r {
	case ToolStateRunningStatusRunning:
		return true
	}
	return false
}

type ToolStateRunningTime struct {
	Start float64                  `json:"start,required"`
	JSON  toolStateRunningTimeJSON `json:"-"`
}

// toolStateRunningTimeJSON contains the JSON metadata for the struct
// [ToolStateRunningTime]
type toolStateRunningTimeJSON struct {
	Start       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolStateRunningTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolStateRunningTimeJSON) RawJSON() string {
	return r.raw
}

type UserMessage struct {
	ID        string             `json:"id,required"`
	Role      UserMessageRole    `json:"role,required"`
	SessionID string             `json:"sessionID,required"`
	Time      UserMessageTime    `json:"time,required"`
	Summary   UserMessageSummary `json:"summary"`
	JSON      userMessageJSON    `json:"-"`
}

// userMessageJSON contains the JSON metadata for the struct [UserMessage]
type userMessageJSON struct {
	ID          apijson.Field
	Role        apijson.Field
	SessionID   apijson.Field
	Time        apijson.Field
	Summary     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *UserMessage) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r userMessageJSON) RawJSON() string {
	return r.raw
}

func (r UserMessage) implementsMessage() {}

type UserMessageRole string

const (
	UserMessageRoleUser UserMessageRole = "user"
)

func (r UserMessageRole) IsKnown() bool {
	switch r {
	case UserMessageRoleUser:
		return true
	}
	return false
}

type UserMessageTime struct {
	Created float64             `json:"created,required"`
	JSON    userMessageTimeJSON `json:"-"`
}

// userMessageTimeJSON contains the JSON metadata for the struct [UserMessageTime]
type userMessageTimeJSON struct {
	Created     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *UserMessageTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r userMessageTimeJSON) RawJSON() string {
	return r.raw
}

type UserMessageSummary struct {
	Diffs []UserMessageSummaryDiff `json:"diffs,required"`
	Body  string                   `json:"body"`
	Title string                   `json:"title"`
	JSON  userMessageSummaryJSON   `json:"-"`
}

// userMessageSummaryJSON contains the JSON metadata for the struct
// [UserMessageSummary]
type userMessageSummaryJSON struct {
	Diffs       apijson.Field
	Body        apijson.Field
	Title       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *UserMessageSummary) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r userMessageSummaryJSON) RawJSON() string {
	return r.raw
}

type UserMessageSummaryDiff struct {
	Additions float64                    `json:"additions,required"`
	After     string                     `json:"after,required"`
	Before    string                     `json:"before,required"`
	Deletions float64                    `json:"deletions,required"`
	File      string                     `json:"file,required"`
	JSON      userMessageSummaryDiffJSON `json:"-"`
}

// userMessageSummaryDiffJSON contains the JSON metadata for the struct
// [UserMessageSummaryDiff]
type userMessageSummaryDiffJSON struct {
	Additions   apijson.Field
	After       apijson.Field
	Before      apijson.Field
	Deletions   apijson.Field
	File        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *UserMessageSummaryDiff) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r userMessageSummaryDiffJSON) RawJSON() string {
	return r.raw
}

type SessionCommandResponse struct {
	Info  AssistantMessage           `json:"info,required"`
	Parts []Part                     `json:"parts,required"`
	JSON  sessionCommandResponseJSON `json:"-"`
}

// sessionCommandResponseJSON contains the JSON metadata for the struct
// [SessionCommandResponse]
type sessionCommandResponseJSON struct {
	Info        apijson.Field
	Parts       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionCommandResponse) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionCommandResponseJSON) RawJSON() string {
	return r.raw
}

type SessionMessageResponse struct {
	Info  Message                    `json:"info,required"`
	Parts []Part                     `json:"parts,required"`
	JSON  sessionMessageResponseJSON `json:"-"`
}

// sessionMessageResponseJSON contains the JSON metadata for the struct
// [SessionMessageResponse]
type sessionMessageResponseJSON struct {
	Info        apijson.Field
	Parts       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionMessageResponse) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionMessageResponseJSON) RawJSON() string {
	return r.raw
}

type SessionMessagesResponse struct {
	Info  Message                     `json:"info,required"`
	Parts []Part                      `json:"parts,required"`
	JSON  sessionMessagesResponseJSON `json:"-"`
}

// sessionMessagesResponseJSON contains the JSON metadata for the struct
// [SessionMessagesResponse]
type sessionMessagesResponseJSON struct {
	Info        apijson.Field
	Parts       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionMessagesResponse) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionMessagesResponseJSON) RawJSON() string {
	return r.raw
}

type SessionPromptResponse struct {
	Info  AssistantMessage          `json:"info,required"`
	Parts []Part                    `json:"parts,required"`
	JSON  sessionPromptResponseJSON `json:"-"`
}

// sessionPromptResponseJSON contains the JSON metadata for the struct
// [SessionPromptResponse]
type sessionPromptResponseJSON struct {
	Info        apijson.Field
	Parts       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *SessionPromptResponse) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sessionPromptResponseJSON) RawJSON() string {
	return r.raw
}

type SessionNewParams struct {
	Directory param.Field[string] `query:"directory"`
	ParentID  param.Field[string] `json:"parentID"`
	Title     param.Field[string] `json:"title"`
}

func (r SessionNewParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionNewParams]'s query parameters as `url.Values`.
func (r SessionNewParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionUpdateParams struct {
	Directory param.Field[string] `query:"directory"`
	Title     param.Field[string] `json:"title"`
}

func (r SessionUpdateParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionUpdateParams]'s query parameters as `url.Values`.
func (r SessionUpdateParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionListParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionListParams]'s query parameters as `url.Values`.
func (r SessionListParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionDeleteParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionDeleteParams]'s query parameters as `url.Values`.
func (r SessionDeleteParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionAbortParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionAbortParams]'s query parameters as `url.Values`.
func (r SessionAbortParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionChildrenParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionChildrenParams]'s query parameters as `url.Values`.
func (r SessionChildrenParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionCommandParams struct {
	Arguments param.Field[string] `json:"arguments,required"`
	Command   param.Field[string] `json:"command,required"`
	Directory param.Field[string] `query:"directory"`
	Agent     param.Field[string] `json:"agent"`
	MessageID param.Field[string] `json:"messageID"`
	Model     param.Field[string] `json:"model"`
}

func (r SessionCommandParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionCommandParams]'s query parameters as `url.Values`.
func (r SessionCommandParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionGetParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionGetParams]'s query parameters as `url.Values`.
func (r SessionGetParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionInitParams struct {
	MessageID  param.Field[string] `json:"messageID,required"`
	ModelID    param.Field[string] `json:"modelID,required"`
	ProviderID param.Field[string] `json:"providerID,required"`
	Directory  param.Field[string] `query:"directory"`
}

func (r SessionInitParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionInitParams]'s query parameters as `url.Values`.
func (r SessionInitParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionMessageParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionMessageParams]'s query parameters as `url.Values`.
func (r SessionMessageParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionMessagesParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionMessagesParams]'s query parameters as `url.Values`.
func (r SessionMessagesParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionPromptParams struct {
	Parts     param.Field[[]SessionPromptParamsPartUnion] `json:"parts,required"`
	Directory param.Field[string]                         `query:"directory"`
	Agent     param.Field[string]                         `json:"agent"`
	MessageID param.Field[string]                         `json:"messageID"`
	Model     param.Field[SessionPromptParamsModel]       `json:"model"`
	NoReply   param.Field[bool]                           `json:"noReply"`
	System    param.Field[string]                         `json:"system"`
	Tools     param.Field[map[string]bool]                `json:"tools"`
}

func (r SessionPromptParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionPromptParams]'s query parameters as `url.Values`.
func (r SessionPromptParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionPromptParamsPart struct {
	Type      param.Field[SessionPromptParamsPartsType] `json:"type,required"`
	ID        param.Field[string]                       `json:"id"`
	Filename  param.Field[string]                       `json:"filename"`
	Metadata  param.Field[interface{}]                  `json:"metadata"`
	Mime      param.Field[string]                       `json:"mime"`
	Name      param.Field[string]                       `json:"name"`
	Source    param.Field[interface{}]                  `json:"source"`
	Synthetic param.Field[bool]                         `json:"synthetic"`
	Text      param.Field[string]                       `json:"text"`
	Time      param.Field[interface{}]                  `json:"time"`
	URL       param.Field[string]                       `json:"url"`
}

func (r SessionPromptParamsPart) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r SessionPromptParamsPart) implementsSessionPromptParamsPartUnion() {}

// Satisfied by [TextPartInputParam], [FilePartInputParam], [AgentPartInputParam],
// [SessionPromptParamsPart].
type SessionPromptParamsPartUnion interface {
	implementsSessionPromptParamsPartUnion()
}

type SessionPromptParamsPartsType string

const (
	SessionPromptParamsPartsTypeText  SessionPromptParamsPartsType = "text"
	SessionPromptParamsPartsTypeFile  SessionPromptParamsPartsType = "file"
	SessionPromptParamsPartsTypeAgent SessionPromptParamsPartsType = "agent"
)

func (r SessionPromptParamsPartsType) IsKnown() bool {
	switch r {
	case SessionPromptParamsPartsTypeText, SessionPromptParamsPartsTypeFile, SessionPromptParamsPartsTypeAgent:
		return true
	}
	return false
}

type SessionPromptParamsModel struct {
	ModelID    param.Field[string] `json:"modelID,required"`
	ProviderID param.Field[string] `json:"providerID,required"`
}

func (r SessionPromptParamsModel) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type SessionRevertParams struct {
	MessageID param.Field[string] `json:"messageID,required"`
	Directory param.Field[string] `query:"directory"`
	PartID    param.Field[string] `json:"partID"`
}

func (r SessionRevertParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionRevertParams]'s query parameters as `url.Values`.
func (r SessionRevertParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionShareParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionShareParams]'s query parameters as `url.Values`.
func (r SessionShareParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionShellParams struct {
	Agent     param.Field[string] `json:"agent,required"`
	Command   param.Field[string] `json:"command,required"`
	Directory param.Field[string] `query:"directory"`
}

func (r SessionShellParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionShellParams]'s query parameters as `url.Values`.
func (r SessionShellParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionSummarizeParams struct {
	ModelID    param.Field[string] `json:"modelID,required"`
	ProviderID param.Field[string] `json:"providerID,required"`
	Directory  param.Field[string] `query:"directory"`
}

func (r SessionSummarizeParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// URLQuery serializes [SessionSummarizeParams]'s query parameters as `url.Values`.
func (r SessionSummarizeParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionUnrevertParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionUnrevertParams]'s query parameters as `url.Values`.
func (r SessionUnrevertParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}

type SessionUnshareParams struct {
	Directory param.Field[string] `query:"directory"`
}

// URLQuery serializes [SessionUnshareParams]'s query parameters as `url.Values`.
func (r SessionUnshareParams) URLQuery() (v url.Values) {
	return apiquery.MarshalWithSettings(r, apiquery.QuerySettings{
		ArrayFormat:  apiquery.ArrayQueryFormatComma,
		NestedFormat: apiquery.NestedQueryFormatBrackets,
	})
}
