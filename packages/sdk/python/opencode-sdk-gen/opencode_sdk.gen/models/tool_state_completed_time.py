from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ToolStateCompletedTime")


@_attrs_define
class ToolStateCompletedTime:
    """
    Attributes:
        start (int):
        end (int):
        compacted (int | Unset):
    """

    start: int
    end: int
    compacted: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        end = self.end

        compacted = self.compacted

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "start": start,
                "end": end,
            }
        )
        if compacted is not UNSET:
            field_dict["compacted"] = compacted

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start")

        end = d.pop("end")

        compacted = d.pop("compacted", UNSET)

        tool_state_completed_time = cls(
            start=start,
            end=end,
            compacted=compacted,
        )

        return tool_state_completed_time
