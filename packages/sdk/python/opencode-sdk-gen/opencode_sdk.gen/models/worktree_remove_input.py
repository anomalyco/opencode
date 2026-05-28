from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="WorktreeRemoveInput")


@_attrs_define
class WorktreeRemoveInput:
    """
    Attributes:
        directory (str):
    """

    directory: str

    def to_dict(self) -> dict[str, Any]:
        directory = self.directory

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "directory": directory,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        directory = d.pop("directory")

        worktree_remove_input = cls(
            directory=directory,
        )

        return worktree_remove_input
