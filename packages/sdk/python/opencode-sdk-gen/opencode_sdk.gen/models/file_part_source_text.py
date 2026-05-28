from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="FilePartSourceText")


@_attrs_define
class FilePartSourceText:
    """
    Attributes:
        value (str):
        start (float):
        end (float):
    """

    value: str
    start: float
    end: float

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        start = self.start

        end = self.end

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "value": value,
                "start": start,
                "end": end,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        value = d.pop("value")

        start = d.pop("start")

        end = d.pop("end")

        file_part_source_text = cls(
            value=value,
            start=start,
            end=end,
        )

        return file_part_source_text
