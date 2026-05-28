from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="AgentModel")


@_attrs_define
class AgentModel:
    """
    Attributes:
        model_id (str):
        provider_id (str):
    """

    model_id: str
    provider_id: str

    def to_dict(self) -> dict[str, Any]:
        model_id = self.model_id

        provider_id = self.provider_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "modelID": model_id,
                "providerID": provider_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        model_id = d.pop("modelID")

        provider_id = d.pop("providerID")

        agent_model = cls(
            model_id=model_id,
            provider_id=provider_id,
        )

        return agent_model
