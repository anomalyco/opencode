from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ToolStateErrorTime")


@_attrs_define
class ToolStateErrorTime:
    """
    Attributes:
        start (int):
        end (int):
    """

    start: int
    end: int

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        end = self.end

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "start": start,
                "end": end,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start")

        end = d.pop("end")

        tool_state_error_time = cls(
            start=start,
            end=end,
        )

        return tool_state_error_time
