from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_account_added_type import EventAccountAddedType

if TYPE_CHECKING:
    from ..models.event_account_added_properties import EventAccountAddedProperties


T = TypeVar("T", bound="EventAccountAdded")


@_attrs_define
class EventAccountAdded:
    """
    Attributes:
        id (str):
        type_ (EventAccountAddedType):
        properties (EventAccountAddedProperties):
    """

    id: str
    type_: EventAccountAddedType
    properties: EventAccountAddedProperties

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
        from ..models.event_account_added_properties import EventAccountAddedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventAccountAddedType(d.pop("type"))

        properties = EventAccountAddedProperties.from_dict(d.pop("properties"))

        event_account_added = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_account_added
