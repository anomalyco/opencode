from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_message_part_removed_type import EventMessagePartRemovedType

if TYPE_CHECKING:
    from ..models.event_message_part_removed_properties import EventMessagePartRemovedProperties


T = TypeVar("T", bound="EventMessagePartRemoved")


@_attrs_define
class EventMessagePartRemoved:
    """
    Attributes:
        id (str):
        type_ (EventMessagePartRemovedType):
        properties (EventMessagePartRemovedProperties):
    """

    id: str
    type_: EventMessagePartRemovedType
    properties: EventMessagePartRemovedProperties

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
        from ..models.event_message_part_removed_properties import EventMessagePartRemovedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventMessagePartRemovedType(d.pop("type"))

        properties = EventMessagePartRemovedProperties.from_dict(d.pop("properties"))

        event_message_part_removed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_message_part_removed
