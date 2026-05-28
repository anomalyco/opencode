from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="SessionPromptBodyModel")


@_attrs_define
class SessionPromptBodyModel:
    """
    Attributes:
        provider_id (str):
        model_id (str):
    """

    provider_id: str
    model_id: str

    def to_dict(self) -> dict[str, Any]:
        provider_id = self.provider_id

        model_id = self.model_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "providerID": provider_id,
                "modelID": model_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        provider_id = d.pop("providerID")

        model_id = d.pop("modelID")

        session_prompt_body_model = cls(
            provider_id=provider_id,
            model_id=model_id,
        )

        return session_prompt_body_model
