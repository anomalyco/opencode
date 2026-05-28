from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventSessionNextShellStartedProperties")


@_attrs_define
class EventSessionNextShellStartedProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        call_id (str):
        command (str):
    """

    timestamp: float
    session_id: str
    call_id: str
    command: str

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        call_id = self.call_id

        command = self.command

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "callID": call_id,
                "command": command,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        call_id = d.pop("callID")

        command = d.pop("command")

        event_session_next_shell_started_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            call_id=call_id,
            command=command,
        )

        return event_session_next_shell_started_properties
