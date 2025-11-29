from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        added = self.added

        removed = self.removed

        status = self.status.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        file.additional_properties = d
        return file

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
