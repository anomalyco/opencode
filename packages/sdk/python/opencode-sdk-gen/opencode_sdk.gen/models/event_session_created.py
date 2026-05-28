from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_session_created_type import EventSessionCreatedType

if TYPE_CHECKING:
    from ..models.event_session_created_properties import EventSessionCreatedProperties


T = TypeVar("T", bound="EventSessionCreated")


@_attrs_define
class EventSessionCreated:
    """
    Attributes:
        id (str):
        type_ (EventSessionCreatedType):
        properties (EventSessionCreatedProperties):
    """

    id: str
    type_: EventSessionCreatedType
    properties: EventSessionCreatedProperties

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
        from ..models.event_session_created_properties import EventSessionCreatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventSessionCreatedType(d.pop("type"))

        properties = EventSessionCreatedProperties.from_dict(d.pop("properties"))

        event_session_created = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_session_created
