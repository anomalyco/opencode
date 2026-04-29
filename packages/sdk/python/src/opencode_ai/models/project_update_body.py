from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.project_update_body_commands import ProjectUpdateBodyCommands
    from ..models.project_update_body_icon import ProjectUpdateBodyIcon


T = TypeVar("T", bound="ProjectUpdateBody")


@_attrs_define
class ProjectUpdateBody:
    """
    Attributes:
        name (str | Unset):
        icon (ProjectUpdateBodyIcon | Unset):
        commands (ProjectUpdateBodyCommands | Unset):
    """

    name: str | Unset = UNSET
    icon: ProjectUpdateBodyIcon | Unset = UNSET
    commands: ProjectUpdateBodyCommands | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.project_update_body_commands import ProjectUpdateBodyCommands
        from ..models.project_update_body_icon import ProjectUpdateBodyIcon

        name = self.name

        icon: dict[str, Any] | Unset = UNSET
        if not isinstance(self.icon, Unset):
            icon = self.icon.to_dict()

        commands: dict[str, Any] | Unset = UNSET
        if not isinstance(self.commands, Unset):
            commands = self.commands.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if icon is not UNSET:
            field_dict["icon"] = icon
        if commands is not UNSET:
            field_dict["commands"] = commands

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.project_update_body_commands import ProjectUpdateBodyCommands
        from ..models.project_update_body_icon import ProjectUpdateBodyIcon

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _icon = d.pop("icon", UNSET)
        icon: ProjectUpdateBodyIcon | Unset
        if isinstance(_icon, Unset):
            icon = UNSET
        else:
            icon = ProjectUpdateBodyIcon.from_dict(_icon)

        _commands = d.pop("commands", UNSET)
        commands: ProjectUpdateBodyCommands | Unset
        if isinstance(_commands, Unset):
            commands = UNSET
        else:
            commands = ProjectUpdateBodyCommands.from_dict(_commands)

        project_update_body = cls(
            name=name,
            icon=icon,
            commands=commands,
        )

        project_update_body.additional_properties = d
        return project_update_body

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
