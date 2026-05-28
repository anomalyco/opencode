from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_error_unknown_type import SessionErrorUnknownType

T = TypeVar("T", bound="SessionErrorUnknown")


@_attrs_define
class SessionErrorUnknown:
    """
    Attributes:
        type_ (SessionErrorUnknownType):
        message (str):
    """

    type_: SessionErrorUnknownType
    message: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionErrorUnknownType(d.pop("type"))

        message = d.pop("message")

        session_error_unknown = cls(
            type_=type_,
            message=message,
        )

        return session_error_unknown
