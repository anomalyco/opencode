from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_session_next_tool_called_type import EventSessionNextToolCalledType

if TYPE_CHECKING:
    from ..models.event_session_next_tool_called_properties import EventSessionNextToolCalledProperties


T = TypeVar("T", bound="EventSessionNextToolCalled")


@_attrs_define
class EventSessionNextToolCalled:
    """
    Attributes:
        id (str):
        type_ (EventSessionNextToolCalledType):
        properties (EventSessionNextToolCalledProperties):
    """

    id: str
    type_: EventSessionNextToolCalledType
    properties: EventSessionNextToolCalledProperties

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_.value

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_session_next_tool_called_properties import EventSessionNextToolCalledProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventSessionNextToolCalledType(d.pop("type"))

        properties = EventSessionNextToolCalledProperties.from_dict(d.pop("properties"))

        event_session_next_tool_called = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_session_next_tool_called
