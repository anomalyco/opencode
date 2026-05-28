from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigCommandAdditionalProperty")


@_attrs_define
class ConfigCommandAdditionalProperty:
    """
    Attributes:
        template (str):
        description (str | Unset):
        agent (str | Unset):
        model (str | Unset):
        subtask (bool | Unset):
    """

    template: str
    description: str | Unset = UNSET
    agent: str | Unset = UNSET
    model: str | Unset = UNSET
    subtask: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        template = self.template

        description = self.description

        agent = self.agent

        model = self.model

        subtask = self.subtask

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "template": template,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if agent is not UNSET:
            field_dict["agent"] = agent
        if model is not UNSET:
            field_dict["model"] = model
        if subtask is not UNSET:
            field_dict["subtask"] = subtask

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        template = d.pop("template")

        description = d.pop("description", UNSET)

        agent = d.pop("agent", UNSET)

        model = d.pop("model", UNSET)

        subtask = d.pop("subtask", UNSET)

        config_command_additional_property = cls(
            template=template,
            description=description,
            agent=agent,
            model=model,
            subtask=subtask,
        )

        return config_command_additional_property
