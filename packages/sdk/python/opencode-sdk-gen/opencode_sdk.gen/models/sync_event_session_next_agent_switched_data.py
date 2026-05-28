from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="SyncEventSessionNextAgentSwitchedData")


@_attrs_define
class SyncEventSessionNextAgentSwitchedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        agent (str):
    """

    timestamp: float
    session_id: str
    agent: str

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        agent = self.agent

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "agent": agent,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        agent = d.pop("agent")

        sync_event_session_next_agent_switched_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            agent=agent,
        )

        return sync_event_session_next_agent_switched_data
