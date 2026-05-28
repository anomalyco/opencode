from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.session_error_unknown import SessionErrorUnknown


T = TypeVar("T", bound="EventSessionNextStepFailedProperties")


@_attrs_define
class EventSessionNextStepFailedProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        error (SessionErrorUnknown):
    """

    timestamp: float
    session_id: str
    error: SessionErrorUnknown

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_error_unknown import SessionErrorUnknown

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        error = SessionErrorUnknown.from_dict(d.pop("error"))

        event_session_next_step_failed_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            error=error,
        )

        return event_session_next_step_failed_properties
