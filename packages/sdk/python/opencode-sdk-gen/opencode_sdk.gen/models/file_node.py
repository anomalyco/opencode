from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.file_node_type import FileNodeType

T = TypeVar("T", bound="FileNode")


@_attrs_define
class FileNode:
    """
    Attributes:
        name (str):
        path (str):
        absolute (str):
        type_ (FileNodeType):
        ignored (bool):
    """

    name: str
    path: str
    absolute: str
    type_: FileNodeType
    ignored: bool

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        path = self.path

        absolute = self.absolute

        type_ = self.type_.value

        ignored = self.ignored

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "path": path,
                "absolute": absolute,
                "type": type_,
                "ignored": ignored,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        path = d.pop("path")

        absolute = d.pop("absolute")

        type_ = FileNodeType(d.pop("type"))

        ignored = d.pop("ignored")

        file_node = cls(
            name=name,
            path=path,
            absolute=absolute,
            type_=type_,
            ignored=ignored,
        )

        return file_node
