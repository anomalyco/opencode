from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="TuiControlNextResponse200")


@_attrs_define
class TuiControlNextResponse200:
    """Next TUI request

    Attributes:
        path (str):
        body (Any):
    """

    path: str
    body: Any

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        body = self.body

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "path": path,
                "body": body,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        body = d.pop("body")

        tui_control_next_response_200 = cls(
            path=path,
            body=body,
        )

        return tui_control_next_response_200
