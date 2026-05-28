from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventFileEditedProperties")


@_attrs_define
class EventFileEditedProperties:
    """
    Attributes:
        file (str):
    """

    file: str

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "file": file,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = d.pop("file")

        event_file_edited_properties = cls(
            file=file,
        )

        return event_file_edited_properties
