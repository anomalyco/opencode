from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.unauthorized_error_tag import UnauthorizedErrorTag

T = TypeVar("T", bound="UnauthorizedError")


@_attrs_define
class UnauthorizedError:
    """
    Attributes:
        field_tag (UnauthorizedErrorTag):
        message (str):
    """

    field_tag: UnauthorizedErrorTag
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
        field_tag = UnauthorizedErrorTag(d.pop("_tag"))

        message = d.pop("message")

        unauthorized_error = cls(
            field_tag=field_tag,
            message=message,
        )

        return unauthorized_error
