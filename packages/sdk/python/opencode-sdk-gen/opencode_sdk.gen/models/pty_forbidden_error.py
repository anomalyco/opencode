from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.pty_forbidden_error_tag import PtyForbiddenErrorTag

T = TypeVar("T", bound="PtyForbiddenError")


@_attrs_define
class PtyForbiddenError:
    """
    Attributes:
        field_tag (PtyForbiddenErrorTag):
        message (str):
    """

    field_tag: PtyForbiddenErrorTag
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
        field_tag = PtyForbiddenErrorTag(d.pop("_tag"))

        message = d.pop("message")

        pty_forbidden_error = cls(
            field_tag=field_tag,
            message=message,
        )

        return pty_forbidden_error
