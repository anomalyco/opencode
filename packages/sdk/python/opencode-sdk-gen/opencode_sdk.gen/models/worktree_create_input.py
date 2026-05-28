from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="WorktreeCreateInput")


@_attrs_define
class WorktreeCreateInput:
    """
    Attributes:
        name (str | Unset):
        start_command (str | Unset): Additional startup script to run after the project's start command
    """

    name: str | Unset = UNSET
    start_command: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        start_command = self.start_command

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if start_command is not UNSET:
            field_dict["startCommand"] = start_command

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        start_command = d.pop("startCommand", UNSET)

        worktree_create_input = cls(
            name=name,
            start_command=start_command,
        )

        return worktree_create_input
