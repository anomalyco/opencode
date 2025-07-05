// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package shared

import (
	"github.com/sst/opencode-sdk-go/internal/apijson"
)

type ProviderAuthError struct {
	Data ProviderAuthErrorData `json:"data,required"`
	Name ProviderAuthErrorName `json:"name,required"`
	JSON providerAuthErrorJSON `json:"-"`
}

// providerAuthErrorJSON contains the JSON metadata for the struct
// [ProviderAuthError]
type providerAuthErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ProviderAuthError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r providerAuthErrorJSON) RawJSON() string {
	return r.raw
}

func (r ProviderAuthError) ImplementsEventListResponseEventSessionErrorPropertiesError() {}

func (r ProviderAuthError) ImplementsMessageMetadataError() {}

type ProviderAuthErrorData struct {
	Message    string                    `json:"message,required"`
	ProviderID string                    `json:"providerID,required"`
	JSON       providerAuthErrorDataJSON `json:"-"`
}

// providerAuthErrorDataJSON contains the JSON metadata for the struct
// [ProviderAuthErrorData]
type providerAuthErrorDataJSON struct {
	Message     apijson.Field
	ProviderID  apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *ProviderAuthErrorData) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r providerAuthErrorDataJSON) RawJSON() string {
	return r.raw
}

type ProviderAuthErrorName string

const (
	ProviderAuthErrorNameProviderAuthError ProviderAuthErrorName = "ProviderAuthError"
)

func (r ProviderAuthErrorName) IsKnown() bool {
	switch r {
	case ProviderAuthErrorNameProviderAuthError:
		return true
	}
	return false
}

type UnknownError struct {
	Data UnknownErrorData `json:"data,required"`
	Name UnknownErrorName `json:"name,required"`
	JSON unknownErrorJSON `json:"-"`
}

// unknownErrorJSON contains the JSON metadata for the struct [UnknownError]
type unknownErrorJSON struct {
	Data        apijson.Field
	Name        apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *UnknownError) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r unknownErrorJSON) RawJSON() string {
	return r.raw
}

func (r UnknownError) ImplementsEventListResponseEventSessionErrorPropertiesError() {}

func (r UnknownError) ImplementsMessageMetadataError() {}

type UnknownErrorData struct {
	Message string               `json:"message,required"`
	JSON    unknownErrorDataJSON `json:"-"`
}

// unknownErrorDataJSON contains the JSON metadata for the struct
// [UnknownErrorData]
type unknownErrorDataJSON struct {
	Message     apijson.Field
	raw         string
	ExtraFields map[string]apijson.Field
}

func (r *UnknownErrorData) UnmarshalJSON(data []byte) (err error) {
	return apijson.UnmarshalRoot(data, r)
}

func (r unknownErrorDataJSON) RawJSON() string {
	return r.raw
}

type UnknownErrorName string

const (
	UnknownErrorNameUnknownError UnknownErrorName = "UnknownError"
)

func (r UnknownErrorName) IsKnown() bool {
	switch r {
	case UnknownErrorNameUnknownError:
		return true
	}
	return false
}
