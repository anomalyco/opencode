from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RetryPartTime")


@_attrs_define
class RetryPartTime:
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

        retry_part_time = cls(
            created=created,
        )

        return retry_part_time
