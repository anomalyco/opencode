from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_pty_created_type import EventPtyCreatedType

if TYPE_CHECKING:
    from ..models.event_pty_created_properties import EventPtyCreatedProperties


T = TypeVar("T", bound="EventPtyCreated")


@_attrs_define
class EventPtyCreated:
    """
    Attributes:
        id (str):
        type_ (EventPtyCreatedType):
        properties (EventPtyCreatedProperties):
    """

    id: str
    type_: EventPtyCreatedType
    properties: EventPtyCreatedProperties

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
        from ..models.event_pty_created_properties import EventPtyCreatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventPtyCreatedType(d.pop("type"))

        properties = EventPtyCreatedProperties.from_dict(d.pop("properties"))

        event_pty_created = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_pty_created
