from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PtyUpdateBodySize")


@_attrs_define
class PtyUpdateBodySize:
    """
    Attributes:
        rows (int):
        cols (int):
    """

    rows: int
    cols: int

    def to_dict(self) -> dict[str, Any]:
        rows = self.rows

        cols = self.cols

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "rows": rows,
                "cols": cols,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        rows = d.pop("rows")

        cols = d.pop("cols")

        pty_update_body_size = cls(
            rows=rows,
            cols=cols,
        )

        return pty_update_body_size
