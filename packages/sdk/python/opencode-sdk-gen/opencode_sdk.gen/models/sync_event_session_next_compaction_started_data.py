from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_compaction_started_data_reason import (
    SyncEventSessionNextCompactionStartedDataReason,
)

T = TypeVar("T", bound="SyncEventSessionNextCompactionStartedData")


@_attrs_define
class SyncEventSessionNextCompactionStartedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        reason (SyncEventSessionNextCompactionStartedDataReason):
    """

    timestamp: float
    session_id: str
    reason: SyncEventSessionNextCompactionStartedDataReason

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        reason = self.reason.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        reason = SyncEventSessionNextCompactionStartedDataReason(d.pop("reason"))

        sync_event_session_next_compaction_started_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            reason=reason,
        )

        return sync_event_session_next_compaction_started_data
