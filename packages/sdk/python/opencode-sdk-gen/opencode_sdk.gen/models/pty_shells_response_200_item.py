from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PtyShellsResponse200Item")


@_attrs_define
class PtyShellsResponse200Item:
    """
    Attributes:
        path (str):
        name (str):
        acceptable (bool):
    """

    path: str
    name: str
    acceptable: bool

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        name = self.name

        acceptable = self.acceptable

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "path": path,
                "name": name,
                "acceptable": acceptable,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        name = d.pop("name")

        acceptable = d.pop("acceptable")

        pty_shells_response_200_item = cls(
            path=path,
            name=name,
            acceptable=acceptable,
        )

        return pty_shells_response_200_item
