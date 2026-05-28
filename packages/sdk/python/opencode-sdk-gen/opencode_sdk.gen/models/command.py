from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.command_source import CommandSource
from ..types import UNSET, Unset

T = TypeVar("T", bound="Command")


@_attrs_define
class Command:
    """
    Attributes:
        name (str):
        template (str):
        hints (list[str]):
        description (str | Unset):
        agent (str | Unset):
        model (str | Unset):
        source (CommandSource | Unset):
        subtask (bool | Unset):
    """

    name: str
    template: str
    hints: list[str]
    description: str | Unset = UNSET
    agent: str | Unset = UNSET
    model: str | Unset = UNSET
    source: CommandSource | Unset = UNSET
    subtask: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        template = self.template

        hints = self.hints

        description = self.description

        agent = self.agent

        model = self.model

        source: str | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.value

        subtask = self.subtask

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "template": template,
                "hints": hints,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if agent is not UNSET:
            field_dict["agent"] = agent
        if model is not UNSET:
            field_dict["model"] = model
        if source is not UNSET:
            field_dict["source"] = source
        if subtask is not UNSET:
            field_dict["subtask"] = subtask

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        template = d.pop("template")

        hints = cast(list[str], d.pop("hints"))

        description = d.pop("description", UNSET)

        agent = d.pop("agent", UNSET)

        model = d.pop("model", UNSET)

        _source = d.pop("source", UNSET)
        source: CommandSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = CommandSource(_source)

        subtask = d.pop("subtask", UNSET)

        command = cls(
            name=name,
            template=template,
            hints=hints,
            description=description,
            agent=agent,
            model=model,
            source=source,
            subtask=subtask,
        )

        return command
