from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.session_next_retry_error import SessionNextRetryError


T = TypeVar("T", bound="SyncEventSessionNextRetriedData")


@_attrs_define
class SyncEventSessionNextRetriedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        attempt (float):
        error (SessionNextRetryError):
    """

    timestamp: float
    session_id: str
    attempt: float
    error: SessionNextRetryError

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        attempt = self.attempt

        error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "attempt": attempt,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_next_retry_error import SessionNextRetryError

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        attempt = d.pop("attempt")

        error = SessionNextRetryError.from_dict(d.pop("error"))

        sync_event_session_next_retried_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            attempt=attempt,
            error=error,
        )

        return sync_event_session_next_retried_data
