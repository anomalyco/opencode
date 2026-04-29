from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        template: str
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
        field_dict.update(self.additional_properties)
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

        def _parse_template(data: object) -> str:
            return cast(str, data)

        template = _parse_template(d.pop("template"))

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

        command.additional_properties = d
        return command

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
