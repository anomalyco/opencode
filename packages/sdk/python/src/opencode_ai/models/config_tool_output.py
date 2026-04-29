from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigToolOutput")


@_attrs_define
class ConfigToolOutput:
    """Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation
    directory and a preview is returned.

        Attributes:
            max_lines (int | Unset): Maximum lines of tool output before it is truncated and saved to disk (default: 2000)
            max_bytes (int | Unset): Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)
    """

    max_lines: int | Unset = UNSET
    max_bytes: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        max_lines = self.max_lines

        max_bytes = self.max_bytes

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        config_tool_output.additional_properties = d
        return config_tool_output

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
