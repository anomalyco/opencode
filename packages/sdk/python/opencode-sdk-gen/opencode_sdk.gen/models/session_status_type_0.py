from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_status_type_0_type import SessionStatusType0Type

T = TypeVar("T", bound="SessionStatusType0")


@_attrs_define
class SessionStatusType0:
    """
    Attributes:
        type_ (SessionStatusType0Type):
    """

    type_: SessionStatusType0Type

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
        type_ = SessionStatusType0Type(d.pop("type"))

        session_status_type_0 = cls(
            type_=type_,
        )

        return session_status_type_0
