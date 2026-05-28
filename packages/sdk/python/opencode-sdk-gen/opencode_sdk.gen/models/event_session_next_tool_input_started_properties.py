from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventSessionNextToolInputStartedProperties")


@_attrs_define
class EventSessionNextToolInputStartedProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        call_id (str):
        name (str):
    """

    timestamp: float
    session_id: str
    call_id: str
    name: str

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        call_id = self.call_id

        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "callID": call_id,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        call_id = d.pop("callID")

        name = d.pop("name")

        event_session_next_tool_input_started_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            call_id=call_id,
            name=name,
        )

        return event_session_next_tool_input_started_properties
