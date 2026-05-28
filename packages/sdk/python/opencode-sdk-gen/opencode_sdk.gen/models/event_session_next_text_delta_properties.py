from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventSessionNextTextDeltaProperties")


@_attrs_define
class EventSessionNextTextDeltaProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        delta (str):
    """

    timestamp: float
    session_id: str
    delta: str

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        delta = self.delta

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "delta": delta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        delta = d.pop("delta")

        event_session_next_text_delta_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            delta=delta,
        )

        return event_session_next_text_delta_properties
