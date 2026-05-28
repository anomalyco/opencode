from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.event_session_next_tool_failed_properties_provider import EventSessionNextToolFailedPropertiesProvider
    from ..models.session_error_unknown import SessionErrorUnknown


T = TypeVar("T", bound="EventSessionNextToolFailedProperties")


@_attrs_define
class EventSessionNextToolFailedProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        call_id (str):
        error (SessionErrorUnknown):
        provider (EventSessionNextToolFailedPropertiesProvider):
    """

    timestamp: float
    session_id: str
    call_id: str
    error: SessionErrorUnknown
    provider: EventSessionNextToolFailedPropertiesProvider

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
        from ..models.event_session_next_tool_failed_properties_provider import (
            EventSessionNextToolFailedPropertiesProvider,
        )
        from ..models.session_error_unknown import SessionErrorUnknown

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        call_id = d.pop("callID")

        error = SessionErrorUnknown.from_dict(d.pop("error"))

        provider = EventSessionNextToolFailedPropertiesProvider.from_dict(d.pop("provider"))

        event_session_next_tool_failed_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            call_id=call_id,
            error=error,
            provider=provider,
        )

        return event_session_next_tool_failed_properties
