from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="V2SessionMessagesResponseCursor")


@_attrs_define
class V2SessionMessagesResponseCursor:
    """
    Attributes:
        previous (str | Unset):
        next_ (str | Unset):
    """

    previous: str | Unset = UNSET
    next_: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        previous = self.previous

        next_ = self.next_

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if previous is not UNSET:
            field_dict["previous"] = previous
        if next_ is not UNSET:
            field_dict["next"] = next_

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        previous = d.pop("previous", UNSET)

        next_ = d.pop("next", UNSET)

        v2_session_messages_response_cursor = cls(
            previous=previous,
            next_=next_,
        )

        return v2_session_messages_response_cursor
