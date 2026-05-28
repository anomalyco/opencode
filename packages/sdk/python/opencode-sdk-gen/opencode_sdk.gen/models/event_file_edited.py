from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_file_edited_type import EventFileEditedType

if TYPE_CHECKING:
    from ..models.event_file_edited_properties import EventFileEditedProperties


T = TypeVar("T", bound="EventFileEdited")


@_attrs_define
class EventFileEdited:
    """
    Attributes:
        id (str):
        type_ (EventFileEditedType):
        properties (EventFileEditedProperties):
    """

    id: str
    type_: EventFileEditedType
    properties: EventFileEditedProperties

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
        from ..models.event_file_edited_properties import EventFileEditedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventFileEditedType(d.pop("type"))

        properties = EventFileEditedProperties.from_dict(d.pop("properties"))

        event_file_edited = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_file_edited
