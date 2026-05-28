from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.pty_not_found_error_tag import PtyNotFoundErrorTag

T = TypeVar("T", bound="PtyNotFoundError")


@_attrs_define
class PtyNotFoundError:
    """
    Attributes:
        field_tag (PtyNotFoundErrorTag):
        pty_id (str):
        message (str):
    """

    field_tag: PtyNotFoundErrorTag
    pty_id: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        pty_id = self.pty_id

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "ptyID": pty_id,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = PtyNotFoundErrorTag(d.pop("_tag"))

        pty_id = d.pop("ptyID")

        message = d.pop("message")

        pty_not_found_error = cls(
            field_tag=field_tag,
            pty_id=pty_id,
            message=message,
        )

        return pty_not_found_error
