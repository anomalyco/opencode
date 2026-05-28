from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventMessageRemovedProperties")


@_attrs_define
class EventMessageRemovedProperties:
    """
    Attributes:
        session_id (str):
        message_id (str):
    """

    session_id: str
    message_id: str

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        message_id = self.message_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
                "messageID": message_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        event_message_removed_properties = cls(
            session_id=session_id,
            message_id=message_id,
        )

        return event_message_removed_properties
