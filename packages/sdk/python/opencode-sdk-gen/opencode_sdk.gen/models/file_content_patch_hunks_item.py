from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="FileContentPatchHunksItem")


@_attrs_define
class FileContentPatchHunksItem:
    """
    Attributes:
        old_start (int):
        old_lines (int):
        new_start (int):
        new_lines (int):
        lines (list[str]):
    """

    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    lines: list[str]

    def to_dict(self) -> dict[str, Any]:
        old_start = self.old_start

        old_lines = self.old_lines

        new_start = self.new_start

        new_lines = self.new_lines

        lines = self.lines

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "oldStart": old_start,
                "oldLines": old_lines,
                "newStart": new_start,
                "newLines": new_lines,
                "lines": lines,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        old_start = d.pop("oldStart")

        old_lines = d.pop("oldLines")

        new_start = d.pop("newStart")

        new_lines = d.pop("newLines")

        lines = cast(list[str], d.pop("lines"))

        file_content_patch_hunks_item = cls(
            old_start=old_start,
            old_lines=old_lines,
            new_start=new_start,
            new_lines=new_lines,
            lines=lines,
        )

        return file_content_patch_hunks_item
