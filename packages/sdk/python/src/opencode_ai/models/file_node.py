from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        path = self.path

        absolute = self.absolute

        type_ = self.type_.value

        ignored = self.ignored

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        file_node.additional_properties = d
        return file_node

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
