from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_message_removed_type import EventMessageRemovedType

if TYPE_CHECKING:
    from ..models.event_message_removed_properties import EventMessageRemovedProperties


T = TypeVar("T", bound="EventMessageRemoved")


@_attrs_define
class EventMessageRemoved:
    """
    Attributes:
        id (str):
        type_ (EventMessageRemovedType):
        properties (EventMessageRemovedProperties):
    """

    id: str
    type_: EventMessageRemovedType
    properties: EventMessageRemovedProperties

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
        from ..models.event_message_removed_properties import EventMessageRemovedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventMessageRemovedType(d.pop("type"))

        properties = EventMessageRemovedProperties.from_dict(d.pop("properties"))

        event_message_removed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_message_removed
