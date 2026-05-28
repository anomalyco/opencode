from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventPtyExitedProperties")


@_attrs_define
class EventPtyExitedProperties:
    """
    Attributes:
        id (str):
        exit_code (int):
    """

    id: str
    exit_code: int

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        exit_code = self.exit_code

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "exitCode": exit_code,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        exit_code = d.pop("exitCode")

        event_pty_exited_properties = cls(
            id=id,
            exit_code=exit_code,
        )

        return event_pty_exited_properties
