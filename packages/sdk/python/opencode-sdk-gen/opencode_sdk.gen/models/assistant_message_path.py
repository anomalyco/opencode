from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="AssistantMessagePath")


@_attrs_define
class AssistantMessagePath:
    """
    Attributes:
        cwd (str):
        root (str):
    """

    cwd: str
    root: str

    def to_dict(self) -> dict[str, Any]:
        cwd = self.cwd

        root = self.root

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "cwd": cwd,
                "root": root,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        cwd = d.pop("cwd")

        root = d.pop("root")

        assistant_message_path = cls(
            cwd=cwd,
            root=root,
        )

        return assistant_message_path
