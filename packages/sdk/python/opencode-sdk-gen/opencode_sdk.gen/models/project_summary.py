from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProjectSummary")


@_attrs_define
class ProjectSummary:
    """
    Attributes:
        id (str):
        worktree (str):
        name (str | Unset):
    """

    id: str
    worktree: str
    name: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        worktree = self.worktree

        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "worktree": worktree,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        worktree = d.pop("worktree")

        name = d.pop("name", UNSET)

        project_summary = cls(
            id=id,
            worktree=worktree,
            name=name,
        )

        return project_summary
