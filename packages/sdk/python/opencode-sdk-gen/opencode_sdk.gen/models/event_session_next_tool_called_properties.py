from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.event_session_next_tool_called_properties_input import EventSessionNextToolCalledPropertiesInput
    from ..models.event_session_next_tool_called_properties_provider import EventSessionNextToolCalledPropertiesProvider


T = TypeVar("T", bound="EventSessionNextToolCalledProperties")


@_attrs_define
class EventSessionNextToolCalledProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        call_id (str):
        tool (str):
        input_ (EventSessionNextToolCalledPropertiesInput):
        provider (EventSessionNextToolCalledPropertiesProvider):
    """

    timestamp: float
    session_id: str
    call_id: str
    tool: str
    input_: EventSessionNextToolCalledPropertiesInput
    provider: EventSessionNextToolCalledPropertiesProvider

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        call_id = self.call_id

        tool = self.tool

        input_ = self.input_.to_dict()

        provider = self.provider.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "callID": call_id,
                "tool": tool,
                "input": input_,
                "provider": provider,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_session_next_tool_called_properties_input import EventSessionNextToolCalledPropertiesInput
        from ..models.event_session_next_tool_called_properties_provider import (
            EventSessionNextToolCalledPropertiesProvider,
        )

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        call_id = d.pop("callID")

        tool = d.pop("tool")

        input_ = EventSessionNextToolCalledPropertiesInput.from_dict(d.pop("input"))

        provider = EventSessionNextToolCalledPropertiesProvider.from_dict(d.pop("provider"))

        event_session_next_tool_called_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            call_id=call_id,
            tool=tool,
            input_=input_,
            provider=provider,
        )

        return event_session_next_tool_called_properties
