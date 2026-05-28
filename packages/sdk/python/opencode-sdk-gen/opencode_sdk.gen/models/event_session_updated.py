from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_session_updated_type import EventSessionUpdatedType

if TYPE_CHECKING:
    from ..models.event_session_updated_properties import EventSessionUpdatedProperties


T = TypeVar("T", bound="EventSessionUpdated")


@_attrs_define
class EventSessionUpdated:
    """
    Attributes:
        id (str):
        type_ (EventSessionUpdatedType):
        properties (EventSessionUpdatedProperties):
    """

    id: str
    type_: EventSessionUpdatedType
    properties: EventSessionUpdatedProperties

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
        from ..models.event_session_updated_properties import EventSessionUpdatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventSessionUpdatedType(d.pop("type"))

        properties = EventSessionUpdatedProperties.from_dict(d.pop("properties"))

        event_session_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_session_updated
