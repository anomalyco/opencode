from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_global_disposed_type import EventGlobalDisposedType

if TYPE_CHECKING:
    from ..models.event_global_disposed_properties import EventGlobalDisposedProperties


T = TypeVar("T", bound="EventGlobalDisposed")


@_attrs_define
class EventGlobalDisposed:
    """
    Attributes:
        id (str):
        type_ (EventGlobalDisposedType):
        properties (EventGlobalDisposedProperties):
    """

    id: str
    type_: EventGlobalDisposedType
    properties: EventGlobalDisposedProperties

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
        from ..models.event_global_disposed_properties import EventGlobalDisposedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventGlobalDisposedType(d.pop("type"))

        properties = EventGlobalDisposedProperties.from_dict(d.pop("properties"))

        event_global_disposed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_global_disposed
