from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_session_next_text_delta_type import EventSessionNextTextDeltaType

if TYPE_CHECKING:
    from ..models.event_session_next_text_delta_properties import EventSessionNextTextDeltaProperties


T = TypeVar("T", bound="EventSessionNextTextDelta")


@_attrs_define
class EventSessionNextTextDelta:
    """
    Attributes:
        id (str):
        type_ (EventSessionNextTextDeltaType):
        properties (EventSessionNextTextDeltaProperties):
    """

    id: str
    type_: EventSessionNextTextDeltaType
    properties: EventSessionNextTextDeltaProperties

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
        from ..models.event_session_next_text_delta_properties import EventSessionNextTextDeltaProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventSessionNextTextDeltaType(d.pop("type"))

        properties = EventSessionNextTextDeltaProperties.from_dict(d.pop("properties"))

        event_session_next_text_delta = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_session_next_text_delta
