from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="FormatterStatus")


@_attrs_define
class FormatterStatus:
    """
    Attributes:
        name (str):
        extensions (list[str]):
        enabled (bool):
    """

    name: str
    extensions: list[str]
    enabled: bool

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        extensions = self.extensions

        enabled = self.enabled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "extensions": extensions,
                "enabled": enabled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        extensions = cast(list[str], d.pop("extensions"))

        enabled = d.pop("enabled")

        formatter_status = cls(
            name=name,
            extensions=extensions,
            enabled=enabled,
        )

        return formatter_status
