from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        icon: dict[str, Any] | Unset = UNSET
        if not isinstance(self.icon, Unset):
            icon = self.icon.to_dict()

        commands: dict[str, Any] | Unset = UNSET
        if not isinstance(self.commands, Unset):
            commands = self.commands.to_dict()

        field_dict: dict[str, Any] = {}

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

        return project_update_body
