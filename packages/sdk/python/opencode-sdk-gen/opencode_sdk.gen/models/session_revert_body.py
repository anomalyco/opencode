from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionRevertBody")


@_attrs_define
class SessionRevertBody:
    """
    Attributes:
        message_id (str):
        part_id (str | Unset):
    """

    message_id: str
    part_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        message_id = self.message_id

        part_id = self.part_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "messageID": message_id,
            }
        )
        if part_id is not UNSET:
            field_dict["partID"] = part_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message_id = d.pop("messageID")

        part_id = d.pop("partID", UNSET)

        session_revert_body = cls(
            message_id=message_id,
            part_id=part_id,
        )

        return session_revert_body
