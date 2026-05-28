from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="Worktree")


@_attrs_define
class Worktree:
    """
    Attributes:
        name (str):
        directory (str):
        branch (str | Unset):
    """

    name: str
    directory: str
    branch: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        directory = self.directory

        branch = self.branch

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "directory": directory,
            }
        )
        if branch is not UNSET:
            field_dict["branch"] = branch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        directory = d.pop("directory")

        branch = d.pop("branch", UNSET)

        worktree = cls(
            name=name,
            directory=directory,
            branch=branch,
        )

        return worktree
