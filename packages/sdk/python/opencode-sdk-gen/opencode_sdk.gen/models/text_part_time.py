from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="TextPartTime")


@_attrs_define
class TextPartTime:
    """
    Attributes:
        start (int):
        end (int | Unset):
    """

    start: int
    end: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        end = self.end

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "start": start,
            }
        )
        if end is not UNSET:
            field_dict["end"] = end

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start")

        end = d.pop("end", UNSET)

        text_part_time = cls(
            start=start,
            end=end,
        )

        return text_part_time
