from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_session_next_text_started_type import EventSessionNextTextStartedType

if TYPE_CHECKING:
    from ..models.event_session_next_text_started_properties import EventSessionNextTextStartedProperties


T = TypeVar("T", bound="EventSessionNextTextStarted")


@_attrs_define
class EventSessionNextTextStarted:
    """
    Attributes:
        id (str):
        type_ (EventSessionNextTextStartedType):
        properties (EventSessionNextTextStartedProperties):
    """

    id: str
    type_: EventSessionNextTextStartedType
    properties: EventSessionNextTextStartedProperties

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
        from ..models.event_session_next_text_started_properties import EventSessionNextTextStartedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventSessionNextTextStartedType(d.pop("type"))

        properties = EventSessionNextTextStartedProperties.from_dict(d.pop("properties"))

        event_session_next_text_started = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_session_next_text_started
