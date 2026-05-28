from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.file_status import FileStatus

T = TypeVar("T", bound="File")


@_attrs_define
class File:
    """
    Attributes:
        path (str):
        added (int):
        removed (int):
        status (FileStatus):
    """

    path: str
    added: int
    removed: int
    status: FileStatus

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        added = self.added

        removed = self.removed

        status = self.status.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "path": path,
                "added": added,
                "removed": removed,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        added = d.pop("added")

        removed = d.pop("removed")

        status = FileStatus(d.pop("status"))

        file = cls(
            path=path,
            added=added,
            removed=removed,
            status=status,
        )

        return file
