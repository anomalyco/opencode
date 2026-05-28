from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_not_found_error_tag import ProviderNotFoundErrorTag

T = TypeVar("T", bound="ProviderNotFoundError")


@_attrs_define
class ProviderNotFoundError:
    """
    Attributes:
        field_tag (ProviderNotFoundErrorTag):
        provider_id (str):
        message (str):
    """

    field_tag: ProviderNotFoundErrorTag
    provider_id: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        provider_id = self.provider_id

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "providerID": provider_id,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = ProviderNotFoundErrorTag(d.pop("_tag"))

        provider_id = d.pop("providerID")

        message = d.pop("message")

        provider_not_found_error = cls(
            field_tag=field_tag,
            provider_id=provider_id,
            message=message,
        )

        return provider_not_found_error
