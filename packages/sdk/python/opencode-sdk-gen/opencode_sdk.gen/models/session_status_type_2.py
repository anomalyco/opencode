from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_status_type_2_type import SessionStatusType2Type

T = TypeVar("T", bound="SessionStatusType2")


@_attrs_define
class SessionStatusType2:
    """
    Attributes:
        type_ (SessionStatusType2Type):
    """

    type_: SessionStatusType2Type

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionStatusType2Type(d.pop("type"))

        session_status_type_2 = cls(
            type_=type_,
        )

        return session_status_type_2
