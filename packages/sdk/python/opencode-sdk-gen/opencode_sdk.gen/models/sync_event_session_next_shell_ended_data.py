from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="SyncEventSessionNextShellEndedData")


@_attrs_define
class SyncEventSessionNextShellEndedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        call_id (str):
        output (str):
    """

    timestamp: float
    session_id: str
    call_id: str
    output: str

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        call_id = self.call_id

        output = self.output

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "callID": call_id,
                "output": output,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        call_id = d.pop("callID")

        output = d.pop("output")

        sync_event_session_next_shell_ended_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            call_id=call_id,
            output=output,
        )

        return sync_event_session_next_shell_ended_data
