from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.project_commands import ProjectCommands
    from ..models.project_icon import ProjectIcon
    from ..models.project_time import ProjectTime


T = TypeVar("T", bound="Project")


@_attrs_define
class Project:
    """
    Attributes:
        id (str):
        worktree (str):
        time (ProjectTime):
        sandboxes (list[str]):
        vcs (Literal['git'] | Unset):
        name (str | Unset):
        icon (ProjectIcon | Unset):
        commands (ProjectCommands | Unset):
    """

    id: str
    worktree: str
    time: ProjectTime
    sandboxes: list[str]
    vcs: Literal["git"] | Unset = UNSET
    name: str | Unset = UNSET
    icon: ProjectIcon | Unset = UNSET
    commands: ProjectCommands | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.project_commands import ProjectCommands
        from ..models.project_icon import ProjectIcon
        from ..models.project_time import ProjectTime

        id = self.id

        worktree = self.worktree

        time = self.time.to_dict()

        sandboxes = self.sandboxes

        vcs = self.vcs

        name = self.name

        icon: dict[str, Any] | Unset = UNSET
        if not isinstance(self.icon, Unset):
            icon = self.icon.to_dict()

        commands: dict[str, Any] | Unset = UNSET
        if not isinstance(self.commands, Unset):
            commands = self.commands.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "worktree": worktree,
                "time": time,
                "sandboxes": sandboxes,
            }
        )
        if vcs is not UNSET:
            field_dict["vcs"] = vcs
        if name is not UNSET:
            field_dict["name"] = name
        if icon is not UNSET:
            field_dict["icon"] = icon
        if commands is not UNSET:
            field_dict["commands"] = commands

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.project_commands import ProjectCommands
        from ..models.project_icon import ProjectIcon
        from ..models.project_time import ProjectTime

        d = dict(src_dict)
        id = d.pop("id")

        worktree = d.pop("worktree")

        time = ProjectTime.from_dict(d.pop("time"))

        sandboxes = cast(list[str], d.pop("sandboxes"))

        vcs = cast(Literal["git"] | Unset, d.pop("vcs", UNSET))
        if vcs != "git" and not isinstance(vcs, Unset):
            raise ValueError(f"vcs must match const 'git', got '{vcs}'")

        name = d.pop("name", UNSET)

        _icon = d.pop("icon", UNSET)
        icon: ProjectIcon | Unset
        if isinstance(_icon, Unset):
            icon = UNSET
        else:
            icon = ProjectIcon.from_dict(_icon)

        _commands = d.pop("commands", UNSET)
        commands: ProjectCommands | Unset
        if isinstance(_commands, Unset):
            commands = UNSET
        else:
            commands = ProjectCommands.from_dict(_commands)

        project = cls(
            id=id,
            worktree=worktree,
            time=time,
            sandboxes=sandboxes,
            vcs=vcs,
            name=name,
            icon=icon,
            commands=commands,
        )

        project.additional_properties = d
        return project

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
