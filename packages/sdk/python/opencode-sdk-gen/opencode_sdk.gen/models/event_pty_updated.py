from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_pty_updated_type import EventPtyUpdatedType

if TYPE_CHECKING:
    from ..models.event_pty_updated_properties import EventPtyUpdatedProperties


T = TypeVar("T", bound="EventPtyUpdated")


@_attrs_define
class EventPtyUpdated:
    """
    Attributes:
        id (str):
        type_ (EventPtyUpdatedType):
        properties (EventPtyUpdatedProperties):
    """

    id: str
    type_: EventPtyUpdatedType
    properties: EventPtyUpdatedProperties

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
        from ..models.event_pty_updated_properties import EventPtyUpdatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventPtyUpdatedType(d.pop("type"))

        properties = EventPtyUpdatedProperties.from_dict(d.pop("properties"))

        event_pty_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_pty_updated
