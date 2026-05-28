from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigToolOutput")


@_attrs_define
class ConfigToolOutput:
    """
    Attributes:
        max_lines (int | Unset):
        max_bytes (int | Unset):
    """

    max_lines: int | Unset = UNSET
    max_bytes: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        max_lines = self.max_lines

        max_bytes = self.max_bytes

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if max_lines is not UNSET:
            field_dict["max_lines"] = max_lines
        if max_bytes is not UNSET:
            field_dict["max_bytes"] = max_bytes

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        max_lines = d.pop("max_lines", UNSET)

        max_bytes = d.pop("max_bytes", UNSET)

        config_tool_output = cls(
            max_lines=max_lines,
            max_bytes=max_bytes,
        )

        return config_tool_output
