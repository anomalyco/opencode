from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionStatusType1")


@_attrs_define
class SessionStatusType1:
    """
    Attributes:
        type_ (Literal['retry']):
        attempt (int):
        message (str):
        next_ (int):
    """

    type_: Literal["retry"]
    attempt: int
    message: str
    next_: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        attempt = self.attempt

        message = self.message

        next_ = self.next_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "attempt": attempt,
                "message": message,
                "next": next_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["retry"], d.pop("type"))
        if type_ != "retry":
            raise ValueError(f"type must match const 'retry', got '{type_}'")

        attempt = d.pop("attempt")

        message = d.pop("message")

        next_ = d.pop("next")

        session_status_type_1 = cls(
            type_=type_,
            attempt=attempt,
            message=message,
            next_=next_,
        )

        session_status_type_1.additional_properties = d
        return session_status_type_1

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
