from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventSessionNextTextEndedProperties")


@_attrs_define
class EventSessionNextTextEndedProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        text (str):
    """

    timestamp: float
    session_id: str
    text: str

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        text = self.text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "text": text,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        text = d.pop("text")

        event_session_next_text_ended_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            text=text,
        )

        return event_session_next_text_ended_properties
