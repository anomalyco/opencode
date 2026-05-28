from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderAuthError1Data")


@_attrs_define
class ProviderAuthError1Data:
    """
    Attributes:
        provider_id (str | Unset):
        field (str | Unset):
        message (str | Unset):
        kind (str | Unset):
    """

    provider_id: str | Unset = UNSET
    field: str | Unset = UNSET
    message: str | Unset = UNSET
    kind: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        provider_id = self.provider_id

        field = self.field

        message = self.message

        kind = self.kind

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if provider_id is not UNSET:
            field_dict["providerID"] = provider_id
        if field is not UNSET:
            field_dict["field"] = field
        if message is not UNSET:
            field_dict["message"] = message
        if kind is not UNSET:
            field_dict["kind"] = kind

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        provider_id = d.pop("providerID", UNSET)

        field = d.pop("field", UNSET)

        message = d.pop("message", UNSET)

        kind = d.pop("kind", UNSET)

        provider_auth_error_1_data = cls(
            provider_id=provider_id,
            field=field,
            message=message,
            kind=kind,
        )

        return provider_auth_error_1_data
