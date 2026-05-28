from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="UserMessageModel")


@_attrs_define
class UserMessageModel:
    """
    Attributes:
        provider_id (str):
        model_id (str):
        variant (str | Unset):
    """

    provider_id: str
    model_id: str
    variant: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        provider_id = self.provider_id

        model_id = self.model_id

        variant = self.variant

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "providerID": provider_id,
                "modelID": model_id,
            }
        )
        if variant is not UNSET:
            field_dict["variant"] = variant

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        provider_id = d.pop("providerID")

        model_id = d.pop("modelID")

        variant = d.pop("variant", UNSET)

        user_message_model = cls(
            provider_id=provider_id,
            model_id=model_id,
            variant=variant,
        )

        return user_message_model
