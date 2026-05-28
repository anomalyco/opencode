from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionForkBody")


@_attrs_define
class SessionForkBody:
    """
    Attributes:
        message_id (str | Unset):
    """

    message_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        message_id = self.message_id

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if message_id is not UNSET:
            field_dict["messageID"] = message_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message_id = d.pop("messageID", UNSET)

        session_fork_body = cls(
            message_id=message_id,
        )

        return session_fork_body
