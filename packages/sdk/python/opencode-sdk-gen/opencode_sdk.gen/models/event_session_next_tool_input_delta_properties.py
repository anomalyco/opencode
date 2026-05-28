from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventSessionNextToolInputDeltaProperties")


@_attrs_define
class EventSessionNextToolInputDeltaProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        call_id (str):
        delta (str):
    """

    timestamp: float
    session_id: str
    call_id: str
    delta: str

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        call_id = self.call_id

        delta = self.delta

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "callID": call_id,
                "delta": delta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        call_id = d.pop("callID")

        delta = d.pop("delta")

        event_session_next_tool_input_delta_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            call_id=call_id,
            delta=delta,
        )

        return event_session_next_tool_input_delta_properties
