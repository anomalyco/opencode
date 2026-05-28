from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventServerInstanceDisposedProperties")


@_attrs_define
class EventServerInstanceDisposedProperties:
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

        event_server_instance_disposed_properties = cls(
            directory=directory,
        )

        return event_server_instance_disposed_properties
