from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RangeStart")


@_attrs_define
class RangeStart:
    """
    Attributes:
        line (int):
        character (int):
    """

    line: int
    character: int

    def to_dict(self) -> dict[str, Any]:
        line = self.line

        character = self.character

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "line": line,
                "character": character,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        line = d.pop("line")

        character = d.pop("character")

        range_start = cls(
            line=line,
            character=character,
        )

        return range_start
