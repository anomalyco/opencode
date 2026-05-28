from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="SyncEventSessionNextReasoningStartedData")


@_attrs_define
class SyncEventSessionNextReasoningStartedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        reasoning_id (str):
    """

    timestamp: float
    session_id: str
    reasoning_id: str

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        reasoning_id = self.reasoning_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "reasoningID": reasoning_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        reasoning_id = d.pop("reasoningID")

        sync_event_session_next_reasoning_started_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            reasoning_id=reasoning_id,
        )

        return sync_event_session_next_reasoning_started_data
