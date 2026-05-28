from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="UserMessageTime")


@_attrs_define
class UserMessageTime:
    """
    Attributes:
        created (int):
    """

    created: int

    def to_dict(self) -> dict[str, Any]:
        created = self.created

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "created": created,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        created = d.pop("created")

        user_message_time = cls(
            created=created,
        )

        return user_message_time
