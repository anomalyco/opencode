from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.session_error_unknown import SessionErrorUnknown
    from ..models.sync_event_session_next_tool_failed_data_provider import SyncEventSessionNextToolFailedDataProvider


T = TypeVar("T", bound="SyncEventSessionNextToolFailedData")


@_attrs_define
class SyncEventSessionNextToolFailedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        call_id (str):
        error (SessionErrorUnknown):
        provider (SyncEventSessionNextToolFailedDataProvider):
    """

    timestamp: float
    session_id: str
    call_id: str
    error: SessionErrorUnknown
    provider: SyncEventSessionNextToolFailedDataProvider

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        call_id = self.call_id

        error = self.error.to_dict()

        provider = self.provider.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "callID": call_id,
                "error": error,
                "provider": provider,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_error_unknown import SessionErrorUnknown
        from ..models.sync_event_session_next_tool_failed_data_provider import (
            SyncEventSessionNextToolFailedDataProvider,
        )

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        call_id = d.pop("callID")

        error = SessionErrorUnknown.from_dict(d.pop("error"))

        provider = SyncEventSessionNextToolFailedDataProvider.from_dict(d.pop("provider"))

        sync_event_session_next_tool_failed_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            call_id=call_id,
            error=error,
            provider=provider,
        )

        return sync_event_session_next_tool_failed_data
