from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ToolStateRunningTime")


@_attrs_define
class ToolStateRunningTime:
    """
    Attributes:
        start (int):
    """

    start: int

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "start": start,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start")

        tool_state_running_time = cls(
            start=start,
        )

        return tool_state_running_time
