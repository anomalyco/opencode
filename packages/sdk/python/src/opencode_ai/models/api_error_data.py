from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error_data_metadata import APIErrorDataMetadata
    from ..models.api_error_data_response_headers import APIErrorDataResponseHeaders


T = TypeVar("T", bound="APIErrorData")


@_attrs_define
class APIErrorData:
    """
    Attributes:
        message (str):
        is_retryable (bool):
        status_code (int | Unset):
        response_headers (APIErrorDataResponseHeaders | Unset):
        response_body (str | Unset):
        metadata (APIErrorDataMetadata | Unset):
    """

    message: str
    is_retryable: bool
    status_code: int | Unset = UNSET
    response_headers: APIErrorDataResponseHeaders | Unset = UNSET
    response_body: str | Unset = UNSET
    metadata: APIErrorDataMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.api_error_data_metadata import APIErrorDataMetadata
        from ..models.api_error_data_response_headers import APIErrorDataResponseHeaders

        message = self.message

        is_retryable = self.is_retryable

        status_code = self.status_code

        response_headers: dict[str, Any] | Unset = UNSET
        if not isinstance(self.response_headers, Unset):
            response_headers = self.response_headers.to_dict()

        response_body = self.response_body

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "message": message,
                "isRetryable": is_retryable,
            }
        )
        if status_code is not UNSET:
            field_dict["statusCode"] = status_code
        if response_headers is not UNSET:
            field_dict["responseHeaders"] = response_headers
        if response_body is not UNSET:
            field_dict["responseBody"] = response_body
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_error_data_metadata import APIErrorDataMetadata
        from ..models.api_error_data_response_headers import APIErrorDataResponseHeaders

        d = dict(src_dict)
        message = d.pop("message")

        is_retryable = d.pop("isRetryable")

        status_code = d.pop("statusCode", UNSET)

        _response_headers = d.pop("responseHeaders", UNSET)
        response_headers: APIErrorDataResponseHeaders | Unset
        if isinstance(_response_headers, Unset):
            response_headers = UNSET
        else:
            response_headers = APIErrorDataResponseHeaders.from_dict(_response_headers)

        response_body = d.pop("responseBody", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: APIErrorDataMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = APIErrorDataMetadata.from_dict(_metadata)

        api_error_data = cls(
            message=message,
            is_retryable=is_retryable,
            status_code=status_code,
            response_headers=response_headers,
            response_body=response_body,
            metadata=metadata,
        )

        api_error_data.additional_properties = d
        return api_error_data

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
