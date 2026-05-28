from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_message_part_updated_type import EventMessagePartUpdatedType

if TYPE_CHECKING:
    from ..models.event_message_part_updated_properties import EventMessagePartUpdatedProperties


T = TypeVar("T", bound="EventMessagePartUpdated")


@_attrs_define
class EventMessagePartUpdated:
    """
    Attributes:
        id (str):
        type_ (EventMessagePartUpdatedType):
        properties (EventMessagePartUpdatedProperties):
    """

    id: str
    type_: EventMessagePartUpdatedType
    properties: EventMessagePartUpdatedProperties

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
        from ..models.event_message_part_updated_properties import EventMessagePartUpdatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventMessagePartUpdatedType(d.pop("type"))

        properties = EventMessagePartUpdatedProperties.from_dict(d.pop("properties"))

        event_message_part_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_message_part_updated
