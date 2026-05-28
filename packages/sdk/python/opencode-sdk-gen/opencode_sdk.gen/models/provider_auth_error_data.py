from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ProviderAuthErrorData")


@_attrs_define
class ProviderAuthErrorData:
    """
    Attributes:
        provider_id (str):
        message (str):
    """

    provider_id: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        provider_id = self.provider_id

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "providerID": provider_id,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        provider_id = d.pop("providerID")

        message = d.pop("message")

        provider_auth_error_data = cls(
            provider_id=provider_id,
            message=message,
        )

        return provider_auth_error_data
