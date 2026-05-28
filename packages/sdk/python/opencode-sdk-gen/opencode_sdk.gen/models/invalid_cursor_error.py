from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.invalid_cursor_error_tag import InvalidCursorErrorTag

T = TypeVar("T", bound="InvalidCursorError")


@_attrs_define
class InvalidCursorError:
    """
    Attributes:
        field_tag (InvalidCursorErrorTag):
        message (str):
    """

    field_tag: InvalidCursorErrorTag
    message: str

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = InvalidCursorErrorTag(d.pop("_tag"))

        message = d.pop("message")

        invalid_cursor_error = cls(
            field_tag=field_tag,
            message=message,
        )

        return invalid_cursor_error
