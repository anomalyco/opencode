from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_session_compacted_type import EventSessionCompactedType

if TYPE_CHECKING:
    from ..models.event_session_compacted_properties import EventSessionCompactedProperties


T = TypeVar("T", bound="EventSessionCompacted")


@_attrs_define
class EventSessionCompacted:
    """
    Attributes:
        id (str):
        type_ (EventSessionCompactedType):
        properties (EventSessionCompactedProperties):
    """

    id: str
    type_: EventSessionCompactedType
    properties: EventSessionCompactedProperties

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
        from ..models.event_session_compacted_properties import EventSessionCompactedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventSessionCompactedType(d.pop("type"))

        properties = EventSessionCompactedProperties.from_dict(d.pop("properties"))

        event_session_compacted = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_session_compacted
