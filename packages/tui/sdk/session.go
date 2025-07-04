// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"reflect"

	"github.com/sst/opencode-sdk-go/internal/apijson"
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
	Options []option.RequestOption
}

// NewSessionService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewSessionService(opts ...option.RequestOption) (r *SessionService) {
	r = &SessionService{}
	r.Options = opts
	return
}

// Create a new session
func (r *SessionService) New(ctx context.Context, opts ...option.RequestOption) (res *Session, err error) {
	opts = append(r.Options[:], opts...)
	path := "session"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, nil, &res, opts...)
	return
}

// List all sessions
func (r *SessionService) List(ctx context.Context, opts ...option.RequestOption) (res *[]Session, err error) {
	opts = append(r.Options[:], opts...)
	path := "session"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, nil, &res, opts...)
	return
}

// Delete a session and all its data
func (r *SessionService) Delete(ctx context.Context, id string, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodDelete, path, nil, &res, opts...)
	return
}

// Abort a session
func (r *SessionService) Abort(ctx context.Context, id string, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/abort", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, nil, &res, opts...)
	return
}

// Create and send a new message to a session
func (r *SessionService) Chat(ctx context.Context, id string, body SessionChatParams, opts ...option.RequestOption) (res *Message, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/message", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Analyze the app and create an AGENTS.md file
func (r *SessionService) Init(ctx context.Context, id string, body SessionInitParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/init", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// List messages for a session
func (r *SessionService) Messages(ctx context.Context, id string, opts ...option.RequestOption) (res *[]Message, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/message", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, nil, &res, opts...)
	return
}

// Share a session
func (r *SessionService) Share(ctx context.Context, id string, opts ...option.RequestOption) (res *Session, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/share", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, nil, &res, opts...)
	return
}

// Summarize the session
func (r *SessionService) Summarize(ctx context.Context, id string, body SessionSummarizeParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/summarize", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

// Unshare the session
func (r *SessionService) Unshare(ctx context.Context, id string, opts ...option.RequestOption) (res *Session, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/share", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodDelete, path, nil, &res, opts...)
	return
}

type FilePart struct {
	MediaType string       `json:"mediaType,required"`
	Type      FilePartType `json:"type,required"`
	URL       string       `json:"url,required"`
	Filename  string       `json:"filename"`
	JSON      filePartJSON `json:"-"`
}

// filePartJSON contains the JSON metadata for the struct [FilePart]
type filePartJSON struct {
	MediaType   apijson.Field
	Type        apijson.Field
	URL         apijson.Field
	Filename    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *FilePart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r filePartJSON) RawJSON() string {
	return r.raw
}

func (r FilePart) implementsMessagePart() {}

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

type FilePartParam struct {
	MediaType param.Field[string]       `json:"mediaType,required"`
	Type      param.Field[FilePartType] `json:"type,required"`
	URL       param.Field[string]       `json:"url,required"`
	Filename  param.Field[string]       `json:"filename"`
}

func (r FilePartParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r FilePartParam) implementsMessagePartUnionParam() {}

type Message struct {
	ID       string          `json:"id,required"`
	Metadata MessageMetadata `json:"metadata,required"`
	Parts    []MessagePart   `json:"parts,required"`
	Role     MessageRole     `json:"role,required"`
	JSON     messageJSON     `json:"-"`
}

// messageJSON contains the JSON metadata for the struct [Message]
type messageJSON struct {
	ID          apijson.Field
	Metadata    apijson.Field
	Parts       apijson.Field
	Role        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *Message) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageJSON) RawJSON() string {
	return r.raw
}

type MessageMetadata struct {
	SessionID string                         `json:"sessionID,required"`
	Time      MessageMetadataTime            `json:"time,required"`
	Tool      map[string]MessageMetadataTool `json:"tool,required"`
	Assistant MessageMetadataAssistant       `json:"assistant"`
	Error     MessageMetadataError           `json:"error"`
	Snapshot  string                         `json:"snapshot"`
	JSON      messageMetadataJSON            `json:"-"`
}

// messageMetadataJSON contains the JSON metadata for the struct [MessageMetadata]
type messageMetadataJSON struct {
	SessionID   apijson.Field
	Time        apijson.Field
	Tool        apijson.Field
	Assistant   apijson.Field
	Error       apijson.Field
	Snapshot    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadata) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataJSON) RawJSON() string {
	return r.raw
}

type MessageMetadataTime struct {
	Created   float64                 `json:"created,required"`
	Completed float64                 `json:"completed"`
	JSON      messageMetadataTimeJSON `json:"-"`
}

// messageMetadataTimeJSON contains the JSON metadata for the struct
// [MessageMetadataTime]
type messageMetadataTimeJSON struct {
	Created     apijson.Field
	Completed   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadataTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataTimeJSON) RawJSON() string {
	return r.raw
}

type MessageMetadataTool struct {
	Time        MessageMetadataToolTime `json:"time,required"`
	Title       string                  `json:"title,required"`
	Snapshot    string                  `json:"snapshot"`
	ExtraFields map[string]interface{}  `json:"-,extras"`
	JSON        messageMetadataToolJSON `json:"-"`
}

// messageMetadataToolJSON contains the JSON metadata for the struct
// [MessageMetadataTool]
type messageMetadataToolJSON struct {
	Time        apijson.Field
	Title       apijson.Field
	Snapshot    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadataTool) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataToolJSON) RawJSON() string {
	return r.raw
}

type MessageMetadataToolTime struct {
	End   float64                     `json:"end,required"`
	Start float64                     `json:"start,required"`
	JSON  messageMetadataToolTimeJSON `json:"-"`
}

// messageMetadataToolTimeJSON contains the JSON metadata for the struct
// [MessageMetadataToolTime]
type messageMetadataToolTimeJSON struct {
	End         apijson.Field
	Start       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadataToolTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataToolTimeJSON) RawJSON() string {
	return r.raw
}

type MessageMetadataAssistant struct {
	Cost       float64                        `json:"cost,required"`
	ModelID    string                         `json:"modelID,required"`
	Path       MessageMetadataAssistantPath   `json:"path,required"`
	ProviderID string                         `json:"providerID,required"`
	System     []string                       `json:"system,required"`
	Tokens     MessageMetadataAssistantTokens `json:"tokens,required"`
	Summary    bool                           `json:"summary"`
	JSON       messageMetadataAssistantJSON   `json:"-"`
}

// messageMetadataAssistantJSON contains the JSON metadata for the struct
// [MessageMetadataAssistant]
type messageMetadataAssistantJSON struct {
	Cost        apijson.Field
	ModelID     apijson.Field
	Path        apijson.Field
	ProviderID  apijson.Field
	System      apijson.Field
	Tokens      apijson.Field
	Summary     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadataAssistant) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataAssistantJSON) RawJSON() string {
	return r.raw
}

type MessageMetadataAssistantPath struct {
	Cwd  string                           `json:"cwd,required"`
	Root string                           `json:"root,required"`
	JSON messageMetadataAssistantPathJSON `json:"-"`
}

// messageMetadataAssistantPathJSON contains the JSON metadata for the struct
// [MessageMetadataAssistantPath]
type messageMetadataAssistantPathJSON struct {
	Cwd         apijson.Field
	Root        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadataAssistantPath) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataAssistantPathJSON) RawJSON() string {
	return r.raw
}

type MessageMetadataAssistantTokens struct {
	Cache     MessageMetadataAssistantTokensCache `json:"cache,required"`
	Input     float64                             `json:"input,required"`
	Output    float64                             `json:"output,required"`
	Reasoning float64                             `json:"reasoning,required"`
	JSON      messageMetadataAssistantTokensJSON  `json:"-"`
}

// messageMetadataAssistantTokensJSON contains the JSON metadata for the struct
// [MessageMetadataAssistantTokens]
type messageMetadataAssistantTokensJSON struct {
	Cache       apijson.Field
	Input       apijson.Field
	Output      apijson.Field
	Reasoning   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadataAssistantTokens) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataAssistantTokensJSON) RawJSON() string {
	return r.raw
}

type MessageMetadataAssistantTokensCache struct {
	Read  float64                                 `json:"read,required"`
	Write float64                                 `json:"write,required"`
	JSON  messageMetadataAssistantTokensCacheJSON `json:"-"`
}

// messageMetadataAssistantTokensCacheJSON contains the JSON metadata for the
// struct [MessageMetadataAssistantTokensCache]
type messageMetadataAssistantTokensCacheJSON struct {
	Read        apijson.Field
	Write       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadataAssistantTokensCache) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataAssistantTokensCacheJSON) RawJSON() string {
	return r.raw
}

type MessageMetadataError struct {
	// This field can have the runtime type of [shared.ProviderAuthErrorData],
	// [shared.UnknownErrorData], [interface{}].
	Data  interface{}              `json:"data,required"`
	Name  MessageMetadataErrorName `json:"name,required"`
	JSON  messageMetadataErrorJSON `json:"-"`
	union MessageMetadataErrorUnion
}

// messageMetadataErrorJSON contains the JSON metadata for the struct
// [MessageMetadataError]
type messageMetadataErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r messageMetadataErrorJSON) RawJSON() string {
	return r.raw
}

func (r *MessageMetadataError) UnmarshalJSON(data []byte) (err error) {
	*r = MessageMetadataError{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [MessageMetadataErrorUnion] interface which you can cast to
// the specific types for more type safety.
//
// Possible runtime types of the union are [shared.ProviderAuthError],
// [shared.UnknownError], [MessageMetadataErrorMessageOutputLengthError].
func (r MessageMetadataError) AsUnion() MessageMetadataErrorUnion {
	return r.union
}

// Union satisfied by [shared.ProviderAuthError], [shared.UnknownError] or
// [MessageMetadataErrorMessageOutputLengthError].
type MessageMetadataErrorUnion interface {
	ImplementsMessageMetadataError()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*MessageMetadataErrorUnion)(nil)).Elem(),
		"name",
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(shared.ProviderAuthError{}),
			DiscriminatorValue: "ProviderAuthError",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(shared.UnknownError{}),
			DiscriminatorValue: "UnknownError",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(MessageMetadataErrorMessageOutputLengthError{}),
			DiscriminatorValue: "MessageOutputLengthError",
		},
	)
}

type MessageMetadataErrorMessageOutputLengthError struct {
	Data interface{}                                      `json:"data,required"`
	Name MessageMetadataErrorMessageOutputLengthErrorName `json:"name,required"`
	JSON messageMetadataErrorMessageOutputLengthErrorJSON `json:"-"`
}

// messageMetadataErrorMessageOutputLengthErrorJSON contains the JSON metadata for
// the struct [MessageMetadataErrorMessageOutputLengthError]
type messageMetadataErrorMessageOutputLengthErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *MessageMetadataErrorMessageOutputLengthError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r messageMetadataErrorMessageOutputLengthErrorJSON) RawJSON() string {
	return r.raw
}

func (r MessageMetadataErrorMessageOutputLengthError) ImplementsMessageMetadataError() {}

type MessageMetadataErrorMessageOutputLengthErrorName string

const (
	MessageMetadataErrorMessageOutputLengthErrorNameMessageOutputLengthError MessageMetadataErrorMessageOutputLengthErrorName = "MessageOutputLengthError"
)

func (r MessageMetadataErrorMessageOutputLengthErrorName) IsKnown() bool {
	switch r {
	case MessageMetadataErrorMessageOutputLengthErrorNameMessageOutputLengthError:
		return true
	}
	return false
}

type MessageMetadataErrorName string

const (
	MessageMetadataErrorNameProviderAuthError        MessageMetadataErrorName = "ProviderAuthError"
	MessageMetadataErrorNameUnknownError             MessageMetadataErrorName = "UnknownError"
	MessageMetadataErrorNameMessageOutputLengthError MessageMetadataErrorName = "MessageOutputLengthError"
)

func (r MessageMetadataErrorName) IsKnown() bool {
	switch r {
	case MessageMetadataErrorNameProviderAuthError, MessageMetadataErrorNameUnknownError, MessageMetadataErrorNameMessageOutputLengthError:
		return true
	}
	return false
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

type MessagePart struct {
	Type      MessagePartType `json:"type,required"`
	Filename  string          `json:"filename"`
	MediaType string          `json:"mediaType"`
	// This field can have the runtime type of [map[string]interface{}].
	ProviderMetadata interface{} `json:"providerMetadata"`
	SourceID         string      `json:"sourceId"`
	Text             string      `json:"text"`
	Title            string      `json:"title"`
	// This field can have the runtime type of [ToolInvocationPartToolInvocation].
	ToolInvocation interface{}     `json:"toolInvocation"`
	URL            string          `json:"url"`
	JSON           messagePartJSON `json:"-"`
	union          MessagePartUnion
}

// messagePartJSON contains the JSON metadata for the struct [MessagePart]
type messagePartJSON struct {
	Type             apijson.Field
	Filename         apijson.Field
	MediaType        apijson.Field
	ProviderMetadata apijson.Field
	SourceID         apijson.Field
	Text             apijson.Field
	Title            apijson.Field
	ToolInvocation   apijson.Field
	URL              apijson.Field
	raw              string
	ExtraFields      map[string]apijson.Field
}

func (r messagePartJSON) RawJSON() string {
	return r.raw
}

func (r *MessagePart) UnmarshalJSON(data []byte) (err error) {
	*r = MessagePart{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [MessagePartUnion] interface which you can cast to the
// specific types for more type safety.
//
// Possible runtime types of the union are [TextPart], [ReasoningPart],
// [ToolInvocationPart], [SourceURLPart], [FilePart], [StepStartPart].
func (r MessagePart) AsUnion() MessagePartUnion {
	return r.union
}

// Union satisfied by [TextPart], [ReasoningPart], [ToolInvocationPart],
// [SourceURLPart], [FilePart] or [StepStartPart].
type MessagePartUnion interface {
	implementsMessagePart()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*MessagePartUnion)(nil)).Elem(),
		"type",
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(TextPart{}),
			DiscriminatorValue: "text",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(ReasoningPart{}),
			DiscriminatorValue: "reasoning",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(ToolInvocationPart{}),
			DiscriminatorValue: "tool-invocation",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(SourceURLPart{}),
			DiscriminatorValue: "source-url",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(FilePart{}),
			DiscriminatorValue: "file",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(StepStartPart{}),
			DiscriminatorValue: "step-start",
		},
	)
}

type MessagePartType string

const (
	MessagePartTypeText           MessagePartType = "text"
	MessagePartTypeReasoning      MessagePartType = "reasoning"
	MessagePartTypeToolInvocation MessagePartType = "tool-invocation"
	MessagePartTypeSourceURL      MessagePartType = "source-url"
	MessagePartTypeFile           MessagePartType = "file"
	MessagePartTypeStepStart      MessagePartType = "step-start"
)

func (r MessagePartType) IsKnown() bool {
	switch r {
	case MessagePartTypeText, MessagePartTypeReasoning, MessagePartTypeToolInvocation, MessagePartTypeSourceURL, MessagePartTypeFile, MessagePartTypeStepStart:
		return true
	}
	return false
}

type MessagePartParam struct {
	Type             param.Field[MessagePartType] `json:"type,required"`
	Filename         param.Field[string]          `json:"filename"`
	MediaType        param.Field[string]          `json:"mediaType"`
	ProviderMetadata param.Field[interface{}]     `json:"providerMetadata"`
	SourceID         param.Field[string]          `json:"sourceId"`
	Text             param.Field[string]          `json:"text"`
	Title            param.Field[string]          `json:"title"`
	ToolInvocation   param.Field[interface{}]     `json:"toolInvocation"`
	URL              param.Field[string]          `json:"url"`
}

func (r MessagePartParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r MessagePartParam) implementsMessagePartUnionParam() {}

// Satisfied by [TextPartParam], [ReasoningPartParam], [ToolInvocationPartParam],
// [SourceURLPartParam], [FilePartParam], [StepStartPartParam], [MessagePartParam].
type MessagePartUnionParam interface {
	implementsMessagePartUnionParam()
}

type ReasoningPart struct {
	Text             string                 `json:"text,required"`
	Type             ReasoningPartType      `json:"type,required"`
	ProviderMetadata map[string]interface{} `json:"providerMetadata"`
	JSON             reasoningPartJSON      `json:"-"`
}

// reasoningPartJSON contains the JSON metadata for the struct [ReasoningPart]
type reasoningPartJSON struct {
	Text             apijson.Field
	Type             apijson.Field
	ProviderMetadata apijson.Field
	raw              string
	ExtraFields      map[string]apijson.Field
}

func (r *ReasoningPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r reasoningPartJSON) RawJSON() string {
	return r.raw
}

func (r ReasoningPart) implementsMessagePart() {}

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

type ReasoningPartParam struct {
	Text             param.Field[string]                 `json:"text,required"`
	Type             param.Field[ReasoningPartType]      `json:"type,required"`
	ProviderMetadata param.Field[map[string]interface{}] `json:"providerMetadata"`
}

func (r ReasoningPartParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r ReasoningPartParam) implementsMessagePartUnionParam() {}

type Session struct {
	ID       string        `json:"id,required"`
	Time     SessionTime   `json:"time,required"`
	Title    string        `json:"title,required"`
	Version  string        `json:"version,required"`
	ParentID string        `json:"parentID"`
	Revert   SessionRevert `json:"revert"`
	Share    SessionShare  `json:"share"`
	JSON     sessionJSON   `json:"-"`
}

// sessionJSON contains the JSON metadata for the struct [Session]
type sessionJSON struct {
	ID          apijson.Field
	Time        apijson.Field
	Title       apijson.Field
	Version     apijson.Field
	ParentID    apijson.Field
	Revert      apijson.Field
	Share       apijson.Field
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
	Created float64         `json:"created,required"`
	Updated float64         `json:"updated,required"`
	JSON    sessionTimeJSON `json:"-"`
}

// sessionTimeJSON contains the JSON metadata for the struct [SessionTime]
type sessionTimeJSON struct {
	Created     apijson.Field
	Updated     apijson.Field
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
	Part      float64           `json:"part,required"`
	Snapshot  string            `json:"snapshot"`
	JSON      sessionRevertJSON `json:"-"`
}

// sessionRevertJSON contains the JSON metadata for the struct [SessionRevert]
type sessionRevertJSON struct {
	MessageID   apijson.Field
	Part        apijson.Field
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

type SourceURLPart struct {
	SourceID         string                 `json:"sourceId,required"`
	Type             SourceURLPartType      `json:"type,required"`
	URL              string                 `json:"url,required"`
	ProviderMetadata map[string]interface{} `json:"providerMetadata"`
	Title            string                 `json:"title"`
	JSON             sourceURLPartJSON      `json:"-"`
}

// sourceURLPartJSON contains the JSON metadata for the struct [SourceURLPart]
type sourceURLPartJSON struct {
	SourceID         apijson.Field
	Type             apijson.Field
	URL              apijson.Field
	ProviderMetadata apijson.Field
	Title            apijson.Field
	raw              string
	ExtraFields      map[string]apijson.Field
}

func (r *SourceURLPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r sourceURLPartJSON) RawJSON() string {
	return r.raw
}

func (r SourceURLPart) implementsMessagePart() {}

type SourceURLPartType string

const (
	SourceURLPartTypeSourceURL SourceURLPartType = "source-url"
)

func (r SourceURLPartType) IsKnown() bool {
	switch r {
	case SourceURLPartTypeSourceURL:
		return true
	}
	return false
}

type SourceURLPartParam struct {
	SourceID         param.Field[string]                 `json:"sourceId,required"`
	Type             param.Field[SourceURLPartType]      `json:"type,required"`
	URL              param.Field[string]                 `json:"url,required"`
	ProviderMetadata param.Field[map[string]interface{}] `json:"providerMetadata"`
	Title            param.Field[string]                 `json:"title"`
}

func (r SourceURLPartParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r SourceURLPartParam) implementsMessagePartUnionParam() {}

type StepStartPart struct {
	Type StepStartPartType `json:"type,required"`
	JSON stepStartPartJSON `json:"-"`
}

// stepStartPartJSON contains the JSON metadata for the struct [StepStartPart]
type stepStartPartJSON struct {
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *StepStartPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r stepStartPartJSON) RawJSON() string {
	return r.raw
}

func (r StepStartPart) implementsMessagePart() {}

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

type StepStartPartParam struct {
	Type param.Field[StepStartPartType] `json:"type,required"`
}

func (r StepStartPartParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r StepStartPartParam) implementsMessagePartUnionParam() {}

type TextPart struct {
	Text string       `json:"text,required"`
	Type TextPartType `json:"type,required"`
	JSON textPartJSON `json:"-"`
}

// textPartJSON contains the JSON metadata for the struct [TextPart]
type textPartJSON struct {
	Text        apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *TextPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r textPartJSON) RawJSON() string {
	return r.raw
}

func (r TextPart) implementsMessagePart() {}

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

type TextPartParam struct {
	Text param.Field[string]       `json:"text,required"`
	Type param.Field[TextPartType] `json:"type,required"`
}

func (r TextPartParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r TextPartParam) implementsMessagePartUnionParam() {}

type ToolCall struct {
	State      ToolCallState `json:"state,required"`
	ToolCallID string        `json:"toolCallId,required"`
	ToolName   string        `json:"toolName,required"`
	Args       interface{}   `json:"args"`
	Step       float64       `json:"step"`
	JSON       toolCallJSON  `json:"-"`
}

// toolCallJSON contains the JSON metadata for the struct [ToolCall]
type toolCallJSON struct {
	State       apijson.Field
	ToolCallID  apijson.Field
	ToolName    apijson.Field
	Args        apijson.Field
	Step        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolCall) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolCallJSON) RawJSON() string {
	return r.raw
}

func (r ToolCall) implementsToolInvocationPartToolInvocation() {}

type ToolCallState string

const (
	ToolCallStateCall ToolCallState = "call"
)

func (r ToolCallState) IsKnown() bool {
	switch r {
	case ToolCallStateCall:
		return true
	}
	return false
}

type ToolCallParam struct {
	State      param.Field[ToolCallState] `json:"state,required"`
	ToolCallID param.Field[string]        `json:"toolCallId,required"`
	ToolName   param.Field[string]        `json:"toolName,required"`
	Args       param.Field[interface{}]   `json:"args"`
	Step       param.Field[float64]       `json:"step"`
}

func (r ToolCallParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r ToolCallParam) implementsToolInvocationPartToolInvocationUnionParam() {}

type ToolInvocationPart struct {
	ToolInvocation ToolInvocationPartToolInvocation `json:"toolInvocation,required"`
	Type           ToolInvocationPartType           `json:"type,required"`
	JSON           toolInvocationPartJSON           `json:"-"`
}

// toolInvocationPartJSON contains the JSON metadata for the struct
// [ToolInvocationPart]
type toolInvocationPartJSON struct {
	ToolInvocation apijson.Field
	Type           apijson.Field
	raw            string
	ExtraFields    map[string]apijson.Field
}

func (r *ToolInvocationPart) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolInvocationPartJSON) RawJSON() string {
	return r.raw
}

func (r ToolInvocationPart) implementsMessagePart() {}

type ToolInvocationPartToolInvocation struct {
	State      ToolInvocationPartToolInvocationState `json:"state,required"`
	ToolCallID string                                `json:"toolCallId,required"`
	ToolName   string                                `json:"toolName,required"`
	// This field can have the runtime type of [interface{}].
	Args   interface{}                          `json:"args"`
	Result string                               `json:"result"`
	Step   float64                              `json:"step"`
	JSON   toolInvocationPartToolInvocationJSON `json:"-"`
	union  ToolInvocationPartToolInvocationUnion
}

// toolInvocationPartToolInvocationJSON contains the JSON metadata for the struct
// [ToolInvocationPartToolInvocation]
type toolInvocationPartToolInvocationJSON struct {
	State       apijson.Field
	ToolCallID  apijson.Field
	ToolName    apijson.Field
	Args        apijson.Field
	Result      apijson.Field
	Step        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r toolInvocationPartToolInvocationJSON) RawJSON() string {
	return r.raw
}

func (r *ToolInvocationPartToolInvocation) UnmarshalJSON(data []byte) (err error) {
	*r = ToolInvocationPartToolInvocation{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [ToolInvocationPartToolInvocationUnion] interface which you
// can cast to the specific types for more type safety.
//
// Possible runtime types of the union are [ToolCall], [ToolPartialCall],
// [ToolResult].
func (r ToolInvocationPartToolInvocation) AsUnion() ToolInvocationPartToolInvocationUnion {
	return r.union
}

// Union satisfied by [ToolCall], [ToolPartialCall] or [ToolResult].
type ToolInvocationPartToolInvocationUnion interface {
	implementsToolInvocationPartToolInvocation()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*ToolInvocationPartToolInvocationUnion)(nil)).Elem(),
		"state",
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(ToolCall{}),
			DiscriminatorValue: "call",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(ToolPartialCall{}),
			DiscriminatorValue: "partial-call",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(ToolResult{}),
			DiscriminatorValue: "result",
		},
	)
}

type ToolInvocationPartToolInvocationState string

const (
	ToolInvocationPartToolInvocationStateCall        ToolInvocationPartToolInvocationState = "call"
	ToolInvocationPartToolInvocationStatePartialCall ToolInvocationPartToolInvocationState = "partial-call"
	ToolInvocationPartToolInvocationStateResult      ToolInvocationPartToolInvocationState = "result"
)

func (r ToolInvocationPartToolInvocationState) IsKnown() bool {
	switch r {
	case ToolInvocationPartToolInvocationStateCall, ToolInvocationPartToolInvocationStatePartialCall, ToolInvocationPartToolInvocationStateResult:
		return true
	}
	return false
}

type ToolInvocationPartType string

const (
	ToolInvocationPartTypeToolInvocation ToolInvocationPartType = "tool-invocation"
)

func (r ToolInvocationPartType) IsKnown() bool {
	switch r {
	case ToolInvocationPartTypeToolInvocation:
		return true
	}
	return false
}

type ToolInvocationPartParam struct {
	ToolInvocation param.Field[ToolInvocationPartToolInvocationUnionParam] `json:"toolInvocation,required"`
	Type           param.Field[ToolInvocationPartType]                     `json:"type,required"`
}

func (r ToolInvocationPartParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r ToolInvocationPartParam) implementsMessagePartUnionParam() {}

type ToolInvocationPartToolInvocationParam struct {
	State      param.Field[ToolInvocationPartToolInvocationState] `json:"state,required"`
	ToolCallID param.Field[string]                                `json:"toolCallId,required"`
	ToolName   param.Field[string]                                `json:"toolName,required"`
	Args       param.Field[interface{}]                           `json:"args"`
	Result     param.Field[string]                                `json:"result"`
	Step       param.Field[float64]                               `json:"step"`
}

func (r ToolInvocationPartToolInvocationParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r ToolInvocationPartToolInvocationParam) implementsToolInvocationPartToolInvocationUnionParam() {
}

// Satisfied by [ToolCallParam], [ToolPartialCallParam], [ToolResultParam],
// [ToolInvocationPartToolInvocationParam].
type ToolInvocationPartToolInvocationUnionParam interface {
	implementsToolInvocationPartToolInvocationUnionParam()
}

type ToolPartialCall struct {
	State      ToolPartialCallState `json:"state,required"`
	ToolCallID string               `json:"toolCallId,required"`
	ToolName   string               `json:"toolName,required"`
	Args       interface{}          `json:"args"`
	Step       float64              `json:"step"`
	JSON       toolPartialCallJSON  `json:"-"`
}

// toolPartialCallJSON contains the JSON metadata for the struct [ToolPartialCall]
type toolPartialCallJSON struct {
	State       apijson.Field
	ToolCallID  apijson.Field
	ToolName    apijson.Field
	Args        apijson.Field
	Step        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolPartialCall) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolPartialCallJSON) RawJSON() string {
	return r.raw
}

func (r ToolPartialCall) implementsToolInvocationPartToolInvocation() {}

type ToolPartialCallState string

const (
	ToolPartialCallStatePartialCall ToolPartialCallState = "partial-call"
)

func (r ToolPartialCallState) IsKnown() bool {
	switch r {
	case ToolPartialCallStatePartialCall:
		return true
	}
	return false
}

type ToolPartialCallParam struct {
	State      param.Field[ToolPartialCallState] `json:"state,required"`
	ToolCallID param.Field[string]               `json:"toolCallId,required"`
	ToolName   param.Field[string]               `json:"toolName,required"`
	Args       param.Field[interface{}]          `json:"args"`
	Step       param.Field[float64]              `json:"step"`
}

func (r ToolPartialCallParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r ToolPartialCallParam) implementsToolInvocationPartToolInvocationUnionParam() {}

type ToolResult struct {
	Result     string          `json:"result,required"`
	State      ToolResultState `json:"state,required"`
	ToolCallID string          `json:"toolCallId,required"`
	ToolName   string          `json:"toolName,required"`
	Args       interface{}     `json:"args"`
	Step       float64         `json:"step"`
	JSON       toolResultJSON  `json:"-"`
}

// toolResultJSON contains the JSON metadata for the struct [ToolResult]
type toolResultJSON struct {
	Result      apijson.Field
	State       apijson.Field
	ToolCallID  apijson.Field
	ToolName    apijson.Field
	Args        apijson.Field
	Step        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ToolResult) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r toolResultJSON) RawJSON() string {
	return r.raw
}

func (r ToolResult) implementsToolInvocationPartToolInvocation() {}

type ToolResultState string

const (
	ToolResultStateResult ToolResultState = "result"
)

func (r ToolResultState) IsKnown() bool {
	switch r {
	case ToolResultStateResult:
		return true
	}
	return false
}

type ToolResultParam struct {
	Result     param.Field[string]          `json:"result,required"`
	State      param.Field[ToolResultState] `json:"state,required"`
	ToolCallID param.Field[string]          `json:"toolCallId,required"`
	ToolName   param.Field[string]          `json:"toolName,required"`
	Args       param.Field[interface{}]     `json:"args"`
	Step       param.Field[float64]         `json:"step"`
}

func (r ToolResultParam) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

func (r ToolResultParam) implementsToolInvocationPartToolInvocationUnionParam() {}

type SessionChatParams struct {
	ModelID    param.Field[string]                  `json:"modelID,required"`
	Parts      param.Field[[]MessagePartUnionParam] `json:"parts,required"`
	ProviderID param.Field[string]                  `json:"providerID,required"`
}

func (r SessionChatParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type SessionInitParams struct {
	ModelID    param.Field[string] `json:"modelID,required"`
	ProviderID param.Field[string] `json:"providerID,required"`
}

func (r SessionInitParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

type SessionSummarizeParams struct {
	ModelID    param.Field[string] `json:"modelID,required"`
	ProviderID param.Field[string] `json:"providerID,required"`
}

func (r SessionSummarizeParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}
