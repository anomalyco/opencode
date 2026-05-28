from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_account_removed_type import EventAccountRemovedType

if TYPE_CHECKING:
    from ..models.event_account_removed_properties import EventAccountRemovedProperties


T = TypeVar("T", bound="EventAccountRemoved")


@_attrs_define
class EventAccountRemoved:
    """
    Attributes:
        id (str):
        type_ (EventAccountRemovedType):
        properties (EventAccountRemovedProperties):
    """

    id: str
    type_: EventAccountRemovedType
    properties: EventAccountRemovedProperties

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
        from ..models.event_account_removed_properties import EventAccountRemovedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventAccountRemovedType(d.pop("type"))

        properties = EventAccountRemovedProperties.from_dict(d.pop("properties"))

        event_account_removed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_account_removed
