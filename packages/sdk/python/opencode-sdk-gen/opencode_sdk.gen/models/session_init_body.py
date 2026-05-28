from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="SessionInitBody")


@_attrs_define
class SessionInitBody:
    """
    Attributes:
        model_id (str):
        provider_id (str):
        message_id (str):
    """

    model_id: str
    provider_id: str
    message_id: str

    def to_dict(self) -> dict[str, Any]:
        model_id = self.model_id

        provider_id = self.provider_id

        message_id = self.message_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "modelID": model_id,
                "providerID": provider_id,
                "messageID": message_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        model_id = d.pop("modelID")

        provider_id = d.pop("providerID")

        message_id = d.pop("messageID")

        session_init_body = cls(
            model_id=model_id,
            provider_id=provider_id,
            message_id=message_id,
        )

        return session_init_body
