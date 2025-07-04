// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"net/http"
	"reflect"

	"github.com/sst/opencode-sdk-go/internal/apijson"
	"github.com/sst/opencode-sdk-go/internal/requestconfig"
	"github.com/sst/opencode-sdk-go/option"
	"github.com/sst/opencode-sdk-go/packages/ssestream"
	"github.com/sst/opencode-sdk-go/shared"
	"github.com/tidwall/gjson"
)

// EventService contains methods and other services that help with interacting with
// the opencode API.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewEventService] method instead.
type EventService struct {
	Options []option.RequestOption
}

// NewEventService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there
// is one), and before any request-specific options.
func NewEventService(opts ...option.RequestOption) (r *EventService) {
	r = &EventService{}
	r.Options = opts
	return
}

// Get events
func (r *EventService) ListStreaming(ctx context.Context, opts ...option.RequestOption) (stream *ssestream.Stream[EventListResponse]) {
	var (
		raw *http.Response
		err error
	)
	opts = append(r.Options[:], opts...)
	path := "event"
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodGet, path, nil, &raw, opts...)
	return ssestream.NewStream[EventListResponse](ssestream.NewDecoder(raw), err)
}

type EventListResponse struct {
	// This field can have the runtime type of
	// [EventListResponseEventLspClientDiagnosticsProperties],
	// [EventListResponseEventPermissionUpdatedProperties],
	// [EventListResponseEventFileEditedProperties],
	// [EventListResponseEventStorageWriteProperties],
	// [EventListResponseEventInstallationUpdatedProperties],
	// [EventListResponseEventMessageUpdatedProperties],
	// [EventListResponseEventMessageRemovedProperties],
	// [EventListResponseEventMessagePartUpdatedProperties],
	// [EventListResponseEventSessionUpdatedProperties],
	// [EventListResponseEventSessionDeletedProperties],
	// [EventListResponseEventSessionIdleProperties],
	// [EventListResponseEventSessionErrorProperties],
	// [EventListResponseEventFileWatcherUpdatedProperties].
	Properties interface{}           `json:"properties,required"`
	Type       EventListResponseType `json:"type,required"`
	JSON       eventListResponseJSON `json:"-"`
	union      EventListResponseUnion
}

// eventListResponseJSON contains the JSON metadata for the struct
// [EventListResponse]
type eventListResponseJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r eventListResponseJSON) RawJSON() string {
	return r.raw
}

func (r *EventListResponse) UnmarshalJSON(data []byte) (err error) {
	*r = EventListResponse{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [EventListResponseUnion] interface which you can cast to the
// specific types for more type safety.
//
// Possible runtime types of the union are
// [EventListResponseEventLspClientDiagnostics],
// [EventListResponseEventPermissionUpdated], [EventListResponseEventFileEdited],
// [EventListResponseEventStorageWrite],
// [EventListResponseEventInstallationUpdated],
// [EventListResponseEventMessageUpdated], [EventListResponseEventMessageRemoved],
// [EventListResponseEventMessagePartUpdated],
// [EventListResponseEventSessionUpdated], [EventListResponseEventSessionDeleted],
// [EventListResponseEventSessionIdle], [EventListResponseEventSessionError],
// [EventListResponseEventFileWatcherUpdated].
func (r EventListResponse) AsUnion() EventListResponseUnion {
	return r.union
}

// Union satisfied by [EventListResponseEventLspClientDiagnostics],
// [EventListResponseEventPermissionUpdated], [EventListResponseEventFileEdited],
// [EventListResponseEventStorageWrite],
// [EventListResponseEventInstallationUpdated],
// [EventListResponseEventMessageUpdated], [EventListResponseEventMessageRemoved],
// [EventListResponseEventMessagePartUpdated],
// [EventListResponseEventSessionUpdated], [EventListResponseEventSessionDeleted],
// [EventListResponseEventSessionIdle], [EventListResponseEventSessionError] or
// [EventListResponseEventFileWatcherUpdated].
type EventListResponseUnion interface {
	implementsEventListResponse()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*EventListResponseUnion)(nil)).Elem(),
		"type",
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventLspClientDiagnostics{}),
			DiscriminatorValue: "lsp.client.diagnostics",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventPermissionUpdated{}),
			DiscriminatorValue: "permission.updated",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventFileEdited{}),
			DiscriminatorValue: "file.edited",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventStorageWrite{}),
			DiscriminatorValue: "storage.write",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventInstallationUpdated{}),
			DiscriminatorValue: "installation.updated",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventMessageUpdated{}),
			DiscriminatorValue: "message.updated",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventMessageRemoved{}),
			DiscriminatorValue: "message.removed",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventMessagePartUpdated{}),
			DiscriminatorValue: "message.part.updated",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventSessionUpdated{}),
			DiscriminatorValue: "session.updated",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventSessionDeleted{}),
			DiscriminatorValue: "session.deleted",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventSessionIdle{}),
			DiscriminatorValue: "session.idle",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventSessionError{}),
			DiscriminatorValue: "session.error",
		},
		apijson.UnionVariant{
			TypeFilter:         gjson.JSON,
			Type:               reflect.TypeOf(EventListResponseEventFileWatcherUpdated{}),
			DiscriminatorValue: "file.watcher.updated",
		},
	)
}

type EventListResponseEventLspClientDiagnostics struct {
	Properties EventListResponseEventLspClientDiagnosticsProperties `json:"properties,required"`
	Type       EventListResponseEventLspClientDiagnosticsType       `json:"type,required"`
	JSON       eventListResponseEventLspClientDiagnosticsJSON       `json:"-"`
}

// eventListResponseEventLspClientDiagnosticsJSON contains the JSON metadata for
// the struct [EventListResponseEventLspClientDiagnostics]
type eventListResponseEventLspClientDiagnosticsJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventLspClientDiagnostics) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventLspClientDiagnosticsJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventLspClientDiagnostics) implementsEventListResponse() {}

type EventListResponseEventLspClientDiagnosticsProperties struct {
	Path     string                                                   `json:"path,required"`
	ServerID string                                                   `json:"serverID,required"`
	JSON     eventListResponseEventLspClientDiagnosticsPropertiesJSON `json:"-"`
}

// eventListResponseEventLspClientDiagnosticsPropertiesJSON contains the JSON
// metadata for the struct [EventListResponseEventLspClientDiagnosticsProperties]
type eventListResponseEventLspClientDiagnosticsPropertiesJSON struct {
	Path        apijson.Field
	ServerID    apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventLspClientDiagnosticsProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventLspClientDiagnosticsPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventLspClientDiagnosticsType string

const (
	EventListResponseEventLspClientDiagnosticsTypeLspClientDiagnostics EventListResponseEventLspClientDiagnosticsType = "lsp.client.diagnostics"
)

func (r EventListResponseEventLspClientDiagnosticsType) IsKnown() bool {
	switch r {
	case EventListResponseEventLspClientDiagnosticsTypeLspClientDiagnostics:
		return true
	}
	return false
}

type EventListResponseEventPermissionUpdated struct {
	Properties EventListResponseEventPermissionUpdatedProperties `json:"properties,required"`
	Type       EventListResponseEventPermissionUpdatedType       `json:"type,required"`
	JSON       eventListResponseEventPermissionUpdatedJSON       `json:"-"`
}

// eventListResponseEventPermissionUpdatedJSON contains the JSON metadata for the
// struct [EventListResponseEventPermissionUpdated]
type eventListResponseEventPermissionUpdatedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventPermissionUpdated) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventPermissionUpdatedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventPermissionUpdated) implementsEventListResponse() {}

type EventListResponseEventPermissionUpdatedProperties struct {
	ID        string                                                `json:"id,required"`
	Metadata  map[string]interface{}                                `json:"metadata,required"`
	SessionID string                                                `json:"sessionID,required"`
	Time      EventListResponseEventPermissionUpdatedPropertiesTime `json:"time,required"`
	Title     string                                                `json:"title,required"`
	JSON      eventListResponseEventPermissionUpdatedPropertiesJSON `json:"-"`
}

// eventListResponseEventPermissionUpdatedPropertiesJSON contains the JSON metadata
// for the struct [EventListResponseEventPermissionUpdatedProperties]
type eventListResponseEventPermissionUpdatedPropertiesJSON struct {
	ID          apijson.Field
	Metadata    apijson.Field
	SessionID   apijson.Field
	Time        apijson.Field
	Title       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventPermissionUpdatedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventPermissionUpdatedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventPermissionUpdatedPropertiesTime struct {
	Created float64                                                   `json:"created,required"`
	JSON    eventListResponseEventPermissionUpdatedPropertiesTimeJSON `json:"-"`
}

// eventListResponseEventPermissionUpdatedPropertiesTimeJSON contains the JSON
// metadata for the struct [EventListResponseEventPermissionUpdatedPropertiesTime]
type eventListResponseEventPermissionUpdatedPropertiesTimeJSON struct {
	Created     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventPermissionUpdatedPropertiesTime) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventPermissionUpdatedPropertiesTimeJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventPermissionUpdatedType string

const (
	EventListResponseEventPermissionUpdatedTypePermissionUpdated EventListResponseEventPermissionUpdatedType = "permission.updated"
)

func (r EventListResponseEventPermissionUpdatedType) IsKnown() bool {
	switch r {
	case EventListResponseEventPermissionUpdatedTypePermissionUpdated:
		return true
	}
	return false
}

type EventListResponseEventFileEdited struct {
	Properties EventListResponseEventFileEditedProperties `json:"properties,required"`
	Type       EventListResponseEventFileEditedType       `json:"type,required"`
	JSON       eventListResponseEventFileEditedJSON       `json:"-"`
}

// eventListResponseEventFileEditedJSON contains the JSON metadata for the struct
// [EventListResponseEventFileEdited]
type eventListResponseEventFileEditedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventFileEdited) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventFileEditedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventFileEdited) implementsEventListResponse() {}

type EventListResponseEventFileEditedProperties struct {
	File string                                         `json:"file,required"`
	JSON eventListResponseEventFileEditedPropertiesJSON `json:"-"`
}

// eventListResponseEventFileEditedPropertiesJSON contains the JSON metadata for
// the struct [EventListResponseEventFileEditedProperties]
type eventListResponseEventFileEditedPropertiesJSON struct {
	File        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventFileEditedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventFileEditedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventFileEditedType string

const (
	EventListResponseEventFileEditedTypeFileEdited EventListResponseEventFileEditedType = "file.edited"
)

func (r EventListResponseEventFileEditedType) IsKnown() bool {
	switch r {
	case EventListResponseEventFileEditedTypeFileEdited:
		return true
	}
	return false
}

type EventListResponseEventStorageWrite struct {
	Properties EventListResponseEventStorageWriteProperties `json:"properties,required"`
	Type       EventListResponseEventStorageWriteType       `json:"type,required"`
	JSON       eventListResponseEventStorageWriteJSON       `json:"-"`
}

// eventListResponseEventStorageWriteJSON contains the JSON metadata for the struct
// [EventListResponseEventStorageWrite]
type eventListResponseEventStorageWriteJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventStorageWrite) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventStorageWriteJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventStorageWrite) implementsEventListResponse() {}

type EventListResponseEventStorageWriteProperties struct {
	Key     string                                           `json:"key,required"`
	Content interface{}                                      `json:"content"`
	JSON    eventListResponseEventStorageWritePropertiesJSON `json:"-"`
}

// eventListResponseEventStorageWritePropertiesJSON contains the JSON metadata for
// the struct [EventListResponseEventStorageWriteProperties]
type eventListResponseEventStorageWritePropertiesJSON struct {
	Key         apijson.Field
	Content     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventStorageWriteProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventStorageWritePropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventStorageWriteType string

const (
	EventListResponseEventStorageWriteTypeStorageWrite EventListResponseEventStorageWriteType = "storage.write"
)

func (r EventListResponseEventStorageWriteType) IsKnown() bool {
	switch r {
	case EventListResponseEventStorageWriteTypeStorageWrite:
		return true
	}
	return false
}

type EventListResponseEventInstallationUpdated struct {
	Properties EventListResponseEventInstallationUpdatedProperties `json:"properties,required"`
	Type       EventListResponseEventInstallationUpdatedType       `json:"type,required"`
	JSON       eventListResponseEventInstallationUpdatedJSON       `json:"-"`
}

// eventListResponseEventInstallationUpdatedJSON contains the JSON metadata for the
// struct [EventListResponseEventInstallationUpdated]
type eventListResponseEventInstallationUpdatedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventInstallationUpdated) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventInstallationUpdatedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventInstallationUpdated) implementsEventListResponse() {}

type EventListResponseEventInstallationUpdatedProperties struct {
	Version string                                                  `json:"version,required"`
	JSON    eventListResponseEventInstallationUpdatedPropertiesJSON `json:"-"`
}

// eventListResponseEventInstallationUpdatedPropertiesJSON contains the JSON
// metadata for the struct [EventListResponseEventInstallationUpdatedProperties]
type eventListResponseEventInstallationUpdatedPropertiesJSON struct {
	Version     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventInstallationUpdatedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventInstallationUpdatedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventInstallationUpdatedType string

const (
	EventListResponseEventInstallationUpdatedTypeInstallationUpdated EventListResponseEventInstallationUpdatedType = "installation.updated"
)

func (r EventListResponseEventInstallationUpdatedType) IsKnown() bool {
	switch r {
	case EventListResponseEventInstallationUpdatedTypeInstallationUpdated:
		return true
	}
	return false
}

type EventListResponseEventMessageUpdated struct {
	Properties EventListResponseEventMessageUpdatedProperties `json:"properties,required"`
	Type       EventListResponseEventMessageUpdatedType       `json:"type,required"`
	JSON       eventListResponseEventMessageUpdatedJSON       `json:"-"`
}

// eventListResponseEventMessageUpdatedJSON contains the JSON metadata for the
// struct [EventListResponseEventMessageUpdated]
type eventListResponseEventMessageUpdatedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventMessageUpdated) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventMessageUpdatedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventMessageUpdated) implementsEventListResponse() {}

type EventListResponseEventMessageUpdatedProperties struct {
	Info Message                                            `json:"info,required"`
	JSON eventListResponseEventMessageUpdatedPropertiesJSON `json:"-"`
}

// eventListResponseEventMessageUpdatedPropertiesJSON contains the JSON metadata
// for the struct [EventListResponseEventMessageUpdatedProperties]
type eventListResponseEventMessageUpdatedPropertiesJSON struct {
	Info        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventMessageUpdatedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventMessageUpdatedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventMessageUpdatedType string

const (
	EventListResponseEventMessageUpdatedTypeMessageUpdated EventListResponseEventMessageUpdatedType = "message.updated"
)

func (r EventListResponseEventMessageUpdatedType) IsKnown() bool {
	switch r {
	case EventListResponseEventMessageUpdatedTypeMessageUpdated:
		return true
	}
	return false
}

type EventListResponseEventMessageRemoved struct {
	Properties EventListResponseEventMessageRemovedProperties `json:"properties,required"`
	Type       EventListResponseEventMessageRemovedType       `json:"type,required"`
	JSON       eventListResponseEventMessageRemovedJSON       `json:"-"`
}

// eventListResponseEventMessageRemovedJSON contains the JSON metadata for the
// struct [EventListResponseEventMessageRemoved]
type eventListResponseEventMessageRemovedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventMessageRemoved) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventMessageRemovedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventMessageRemoved) implementsEventListResponse() {}

type EventListResponseEventMessageRemovedProperties struct {
	MessageID string                                             `json:"messageID,required"`
	SessionID string                                             `json:"sessionID,required"`
	JSON      eventListResponseEventMessageRemovedPropertiesJSON `json:"-"`
}

// eventListResponseEventMessageRemovedPropertiesJSON contains the JSON metadata
// for the struct [EventListResponseEventMessageRemovedProperties]
type eventListResponseEventMessageRemovedPropertiesJSON struct {
	MessageID   apijson.Field
	SessionID   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventMessageRemovedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventMessageRemovedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventMessageRemovedType string

const (
	EventListResponseEventMessageRemovedTypeMessageRemoved EventListResponseEventMessageRemovedType = "message.removed"
)

func (r EventListResponseEventMessageRemovedType) IsKnown() bool {
	switch r {
	case EventListResponseEventMessageRemovedTypeMessageRemoved:
		return true
	}
	return false
}

type EventListResponseEventMessagePartUpdated struct {
	Properties EventListResponseEventMessagePartUpdatedProperties `json:"properties,required"`
	Type       EventListResponseEventMessagePartUpdatedType       `json:"type,required"`
	JSON       eventListResponseEventMessagePartUpdatedJSON       `json:"-"`
}

// eventListResponseEventMessagePartUpdatedJSON contains the JSON metadata for the
// struct [EventListResponseEventMessagePartUpdated]
type eventListResponseEventMessagePartUpdatedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventMessagePartUpdated) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventMessagePartUpdatedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventMessagePartUpdated) implementsEventListResponse() {}

type EventListResponseEventMessagePartUpdatedProperties struct {
	MessageID string                                                 `json:"messageID,required"`
	Part      MessagePart                                            `json:"part,required"`
	SessionID string                                                 `json:"sessionID,required"`
	JSON      eventListResponseEventMessagePartUpdatedPropertiesJSON `json:"-"`
}

// eventListResponseEventMessagePartUpdatedPropertiesJSON contains the JSON
// metadata for the struct [EventListResponseEventMessagePartUpdatedProperties]
type eventListResponseEventMessagePartUpdatedPropertiesJSON struct {
	MessageID   apijson.Field
	Part        apijson.Field
	SessionID   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventMessagePartUpdatedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventMessagePartUpdatedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventMessagePartUpdatedType string

const (
	EventListResponseEventMessagePartUpdatedTypeMessagePartUpdated EventListResponseEventMessagePartUpdatedType = "message.part.updated"
)

func (r EventListResponseEventMessagePartUpdatedType) IsKnown() bool {
	switch r {
	case EventListResponseEventMessagePartUpdatedTypeMessagePartUpdated:
		return true
	}
	return false
}

type EventListResponseEventSessionUpdated struct {
	Properties EventListResponseEventSessionUpdatedProperties `json:"properties,required"`
	Type       EventListResponseEventSessionUpdatedType       `json:"type,required"`
	JSON       eventListResponseEventSessionUpdatedJSON       `json:"-"`
}

// eventListResponseEventSessionUpdatedJSON contains the JSON metadata for the
// struct [EventListResponseEventSessionUpdated]
type eventListResponseEventSessionUpdatedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionUpdated) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionUpdatedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventSessionUpdated) implementsEventListResponse() {}

type EventListResponseEventSessionUpdatedProperties struct {
	Info Session                                            `json:"info,required"`
	JSON eventListResponseEventSessionUpdatedPropertiesJSON `json:"-"`
}

// eventListResponseEventSessionUpdatedPropertiesJSON contains the JSON metadata
// for the struct [EventListResponseEventSessionUpdatedProperties]
type eventListResponseEventSessionUpdatedPropertiesJSON struct {
	Info        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionUpdatedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionUpdatedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventSessionUpdatedType string

const (
	EventListResponseEventSessionUpdatedTypeSessionUpdated EventListResponseEventSessionUpdatedType = "session.updated"
)

func (r EventListResponseEventSessionUpdatedType) IsKnown() bool {
	switch r {
	case EventListResponseEventSessionUpdatedTypeSessionUpdated:
		return true
	}
	return false
}

type EventListResponseEventSessionDeleted struct {
	Properties EventListResponseEventSessionDeletedProperties `json:"properties,required"`
	Type       EventListResponseEventSessionDeletedType       `json:"type,required"`
	JSON       eventListResponseEventSessionDeletedJSON       `json:"-"`
}

// eventListResponseEventSessionDeletedJSON contains the JSON metadata for the
// struct [EventListResponseEventSessionDeleted]
type eventListResponseEventSessionDeletedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionDeleted) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionDeletedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventSessionDeleted) implementsEventListResponse() {}

type EventListResponseEventSessionDeletedProperties struct {
	Info Session                                            `json:"info,required"`
	JSON eventListResponseEventSessionDeletedPropertiesJSON `json:"-"`
}

// eventListResponseEventSessionDeletedPropertiesJSON contains the JSON metadata
// for the struct [EventListResponseEventSessionDeletedProperties]
type eventListResponseEventSessionDeletedPropertiesJSON struct {
	Info        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionDeletedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionDeletedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventSessionDeletedType string

const (
	EventListResponseEventSessionDeletedTypeSessionDeleted EventListResponseEventSessionDeletedType = "session.deleted"
)

func (r EventListResponseEventSessionDeletedType) IsKnown() bool {
	switch r {
	case EventListResponseEventSessionDeletedTypeSessionDeleted:
		return true
	}
	return false
}

type EventListResponseEventSessionIdle struct {
	Properties EventListResponseEventSessionIdleProperties `json:"properties,required"`
	Type       EventListResponseEventSessionIdleType       `json:"type,required"`
	JSON       eventListResponseEventSessionIdleJSON       `json:"-"`
}

// eventListResponseEventSessionIdleJSON contains the JSON metadata for the struct
// [EventListResponseEventSessionIdle]
type eventListResponseEventSessionIdleJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionIdle) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionIdleJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventSessionIdle) implementsEventListResponse() {}

type EventListResponseEventSessionIdleProperties struct {
	SessionID string                                          `json:"sessionID,required"`
	JSON      eventListResponseEventSessionIdlePropertiesJSON `json:"-"`
}

// eventListResponseEventSessionIdlePropertiesJSON contains the JSON metadata for
// the struct [EventListResponseEventSessionIdleProperties]
type eventListResponseEventSessionIdlePropertiesJSON struct {
	SessionID   apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionIdleProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionIdlePropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventSessionIdleType string

const (
	EventListResponseEventSessionIdleTypeSessionIdle EventListResponseEventSessionIdleType = "session.idle"
)

func (r EventListResponseEventSessionIdleType) IsKnown() bool {
	switch r {
	case EventListResponseEventSessionIdleTypeSessionIdle:
		return true
	}
	return false
}

type EventListResponseEventSessionError struct {
	Properties EventListResponseEventSessionErrorProperties `json:"properties,required"`
	Type       EventListResponseEventSessionErrorType       `json:"type,required"`
	JSON       eventListResponseEventSessionErrorJSON       `json:"-"`
}

// eventListResponseEventSessionErrorJSON contains the JSON metadata for the struct
// [EventListResponseEventSessionError]
type eventListResponseEventSessionErrorJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionErrorJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventSessionError) implementsEventListResponse() {}

type EventListResponseEventSessionErrorProperties struct {
	Error EventListResponseEventSessionErrorPropertiesError `json:"error"`
	JSON  eventListResponseEventSessionErrorPropertiesJSON  `json:"-"`
}

// eventListResponseEventSessionErrorPropertiesJSON contains the JSON metadata for
// the struct [EventListResponseEventSessionErrorProperties]
type eventListResponseEventSessionErrorPropertiesJSON struct {
	Error       apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionErrorProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionErrorPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventSessionErrorPropertiesError struct {
	// This field can have the runtime type of [shared.ProviderAuthErrorData],
	// [shared.UnknownErrorData], [interface{}].
	Data  interface{}                                           `json:"data,required"`
	Name  EventListResponseEventSessionErrorPropertiesErrorName `json:"name,required"`
	JSON  eventListResponseEventSessionErrorPropertiesErrorJSON `json:"-"`
	union EventListResponseEventSessionErrorPropertiesErrorUnion
}

// eventListResponseEventSessionErrorPropertiesErrorJSON contains the JSON metadata
// for the struct [EventListResponseEventSessionErrorPropertiesError]
type eventListResponseEventSessionErrorPropertiesErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r eventListResponseEventSessionErrorPropertiesErrorJSON) RawJSON() string {
	return r.raw
}

func (r *EventListResponseEventSessionErrorPropertiesError) UnmarshalJSON(data []byte) (err error) {
	*r = EventListResponseEventSessionErrorPropertiesError{}
	err = apijson.UnmarshalRoot(data, &r.union)
	if err != nil {
		return err
	}
	return apijson.Port(r.union, &r)
}

// AsUnion returns a [EventListResponseEventSessionErrorPropertiesErrorUnion]
// interface which you can cast to the specific types for more type safety.
//
// Possible runtime types of the union are [shared.ProviderAuthError],
// [shared.UnknownError],
// [EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthError].
func (r EventListResponseEventSessionErrorPropertiesError) AsUnion() EventListResponseEventSessionErrorPropertiesErrorUnion {
	return r.union
}

// Union satisfied by [shared.ProviderAuthError], [shared.UnknownError] or
// [EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthError].
type EventListResponseEventSessionErrorPropertiesErrorUnion interface {
	ImplementsEventListResponseEventSessionErrorPropertiesError()
}

func init() {
	apijson.RegisterUnion(
		reflect.TypeOf((*EventListResponseEventSessionErrorPropertiesErrorUnion)(nil)).Elem(),
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
			Type:               reflect.TypeOf(EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthError{}),
			DiscriminatorValue: "MessageOutputLengthError",
		},
	)
}

type EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthError struct {
	Data interface{}                                                                   `json:"data,required"`
	Name EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorName `json:"name,required"`
	JSON eventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorJSON `json:"-"`
}

// eventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorJSON
// contains the JSON metadata for the struct
// [EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthError]
type eventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthError) ImplementsEventListResponseEventSessionErrorPropertiesError() {
}

type EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorName string

const (
	EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorNameMessageOutputLengthError EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorName = "MessageOutputLengthError"
)

func (r EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorName) IsKnown() bool {
	switch r {
	case EventListResponseEventSessionErrorPropertiesErrorMessageOutputLengthErrorNameMessageOutputLengthError:
		return true
	}
	return false
}

type EventListResponseEventSessionErrorPropertiesErrorName string

const (
	EventListResponseEventSessionErrorPropertiesErrorNameProviderAuthError        EventListResponseEventSessionErrorPropertiesErrorName = "ProviderAuthError"
	EventListResponseEventSessionErrorPropertiesErrorNameUnknownError             EventListResponseEventSessionErrorPropertiesErrorName = "UnknownError"
	EventListResponseEventSessionErrorPropertiesErrorNameMessageOutputLengthError EventListResponseEventSessionErrorPropertiesErrorName = "MessageOutputLengthError"
)

func (r EventListResponseEventSessionErrorPropertiesErrorName) IsKnown() bool {
	switch r {
	case EventListResponseEventSessionErrorPropertiesErrorNameProviderAuthError, EventListResponseEventSessionErrorPropertiesErrorNameUnknownError, EventListResponseEventSessionErrorPropertiesErrorNameMessageOutputLengthError:
		return true
	}
	return false
}

type EventListResponseEventSessionErrorType string

const (
	EventListResponseEventSessionErrorTypeSessionError EventListResponseEventSessionErrorType = "session.error"
)

func (r EventListResponseEventSessionErrorType) IsKnown() bool {
	switch r {
	case EventListResponseEventSessionErrorTypeSessionError:
		return true
	}
	return false
}

type EventListResponseEventFileWatcherUpdated struct {
	Properties EventListResponseEventFileWatcherUpdatedProperties `json:"properties,required"`
	Type       EventListResponseEventFileWatcherUpdatedType       `json:"type,required"`
	JSON       eventListResponseEventFileWatcherUpdatedJSON       `json:"-"`
}

// eventListResponseEventFileWatcherUpdatedJSON contains the JSON metadata for the
// struct [EventListResponseEventFileWatcherUpdated]
type eventListResponseEventFileWatcherUpdatedJSON struct {
	Properties  apijson.Field
	Type        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventFileWatcherUpdated) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventFileWatcherUpdatedJSON) RawJSON() string {
	return r.raw
}

func (r EventListResponseEventFileWatcherUpdated) implementsEventListResponse() {}

type EventListResponseEventFileWatcherUpdatedProperties struct {
	Event EventListResponseEventFileWatcherUpdatedPropertiesEvent `json:"event,required"`
	File  string                                                  `json:"file,required"`
	JSON  eventListResponseEventFileWatcherUpdatedPropertiesJSON  `json:"-"`
}

// eventListResponseEventFileWatcherUpdatedPropertiesJSON contains the JSON
// metadata for the struct [EventListResponseEventFileWatcherUpdatedProperties]
type eventListResponseEventFileWatcherUpdatedPropertiesJSON struct {
	Event       apijson.Field
	File        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *EventListResponseEventFileWatcherUpdatedProperties) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r eventListResponseEventFileWatcherUpdatedPropertiesJSON) RawJSON() string {
	return r.raw
}

type EventListResponseEventFileWatcherUpdatedPropertiesEvent string

const (
	EventListResponseEventFileWatcherUpdatedPropertiesEventRename EventListResponseEventFileWatcherUpdatedPropertiesEvent = "rename"
	EventListResponseEventFileWatcherUpdatedPropertiesEventChange EventListResponseEventFileWatcherUpdatedPropertiesEvent = "change"
)

func (r EventListResponseEventFileWatcherUpdatedPropertiesEvent) IsKnown() bool {
	switch r {
	case EventListResponseEventFileWatcherUpdatedPropertiesEventRename, EventListResponseEventFileWatcherUpdatedPropertiesEventChange:
		return true
	}
	return false
}

type EventListResponseEventFileWatcherUpdatedType string

const (
	EventListResponseEventFileWatcherUpdatedTypeFileWatcherUpdated EventListResponseEventFileWatcherUpdatedType = "file.watcher.updated"
)

func (r EventListResponseEventFileWatcherUpdatedType) IsKnown() bool {
	switch r {
	case EventListResponseEventFileWatcherUpdatedTypeFileWatcherUpdated:
		return true
	}
	return false
}

type EventListResponseType string

const (
	EventListResponseTypeLspClientDiagnostics EventListResponseType = "lsp.client.diagnostics"
	EventListResponseTypePermissionUpdated    EventListResponseType = "permission.updated"
	EventListResponseTypeFileEdited           EventListResponseType = "file.edited"
	EventListResponseTypeStorageWrite         EventListResponseType = "storage.write"
	EventListResponseTypeInstallationUpdated  EventListResponseType = "installation.updated"
	EventListResponseTypeMessageUpdated       EventListResponseType = "message.updated"
	EventListResponseTypeMessageRemoved       EventListResponseType = "message.removed"
	EventListResponseTypeMessagePartUpdated   EventListResponseType = "message.part.updated"
	EventListResponseTypeSessionUpdated       EventListResponseType = "session.updated"
	EventListResponseTypeSessionDeleted       EventListResponseType = "session.deleted"
	EventListResponseTypeSessionIdle          EventListResponseType = "session.idle"
	EventListResponseTypeSessionError         EventListResponseType = "session.error"
	EventListResponseTypeFileWatcherUpdated   EventListResponseType = "file.watcher.updated"
)

func (r EventListResponseType) IsKnown() bool {
	switch r {
	case EventListResponseTypeLspClientDiagnostics, EventListResponseTypePermissionUpdated, EventListResponseTypeFileEdited, EventListResponseTypeStorageWrite, EventListResponseTypeInstallationUpdated, EventListResponseTypeMessageUpdated, EventListResponseTypeMessageRemoved, EventListResponseTypeMessagePartUpdated, EventListResponseTypeSessionUpdated, EventListResponseTypeSessionDeleted, EventListResponseTypeSessionIdle, EventListResponseTypeSessionError, EventListResponseTypeFileWatcherUpdated:
		return true
	}
	return false
}
