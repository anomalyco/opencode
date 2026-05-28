from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="SessionMessageAssistantModel")


@_attrs_define
class SessionMessageAssistantModel:
    """
    Attributes:
        id (str):
        provider_id (str):
        variant (str):
    """

    id: str
    provider_id: str
    variant: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        provider_id = self.provider_id

        variant = self.variant

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "providerID": provider_id,
                "variant": variant,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        provider_id = d.pop("providerID")

        variant = d.pop("variant")

        session_message_assistant_model = cls(
            id=id,
            provider_id=provider_id,
            variant=variant,
        )

        return session_message_assistant_model
