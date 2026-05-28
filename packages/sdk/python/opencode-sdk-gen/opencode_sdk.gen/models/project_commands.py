from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProjectCommands")


@_attrs_define
class ProjectCommands:
    """
    Attributes:
        start (str | Unset): Startup script to run when creating a new workspace (worktree)
    """

    start: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if start is not UNSET:
            field_dict["start"] = start

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start", UNSET)

        project_commands = cls(
            start=start,
        )

        return project_commands
