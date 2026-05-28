from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_next_retry_error_metadata import SessionNextRetryErrorMetadata
    from ..models.session_next_retry_error_response_headers import SessionNextRetryErrorResponseHeaders


T = TypeVar("T", bound="SessionNextRetryError")


@_attrs_define
class SessionNextRetryError:
    """
    Attributes:
        message (str):
        is_retryable (bool):
        status_code (float | Unset):
        response_headers (SessionNextRetryErrorResponseHeaders | Unset):
        response_body (str | Unset):
        metadata (SessionNextRetryErrorMetadata | Unset):
    """

    message: str
    is_retryable: bool
    status_code: float | Unset = UNSET
    response_headers: SessionNextRetryErrorResponseHeaders | Unset = UNSET
    response_body: str | Unset = UNSET
    metadata: SessionNextRetryErrorMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
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
        from ..models.session_next_retry_error_metadata import SessionNextRetryErrorMetadata
        from ..models.session_next_retry_error_response_headers import SessionNextRetryErrorResponseHeaders

        d = dict(src_dict)
        message = d.pop("message")

        is_retryable = d.pop("isRetryable")

        status_code = d.pop("statusCode", UNSET)

        _response_headers = d.pop("responseHeaders", UNSET)
        response_headers: SessionNextRetryErrorResponseHeaders | Unset
        if isinstance(_response_headers, Unset):
            response_headers = UNSET
        else:
            response_headers = SessionNextRetryErrorResponseHeaders.from_dict(_response_headers)

        response_body = d.pop("responseBody", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionNextRetryErrorMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionNextRetryErrorMetadata.from_dict(_metadata)

        session_next_retry_error = cls(
            message=message,
            is_retryable=is_retryable,
            status_code=status_code,
            response_headers=response_headers,
            response_body=response_body,
            metadata=metadata,
        )

        return session_next_retry_error
