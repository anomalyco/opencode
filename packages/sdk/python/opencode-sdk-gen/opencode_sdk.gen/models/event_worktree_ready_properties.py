from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="EventWorktreeReadyProperties")


@_attrs_define
class EventWorktreeReadyProperties:
    """
    Attributes:
        name (str):
        branch (str | Unset):
    """

    name: str
    branch: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        branch = self.branch

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
            }
        )
        if branch is not UNSET:
            field_dict["branch"] = branch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        branch = d.pop("branch", UNSET)

        event_worktree_ready_properties = cls(
            name=name,
            branch=branch,
        )

        return event_worktree_ready_properties
