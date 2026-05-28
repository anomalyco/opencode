from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReferenceConfigEntryType2")


@_attrs_define
class ReferenceConfigEntryType2:
    """
    Attributes:
        path (str): Absolute path, ~/ path, or workspace-relative path to a local reference directory
    """

    path: str

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "path": path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        reference_config_entry_type_2 = cls(
            path=path,
        )

        return reference_config_entry_type_2
