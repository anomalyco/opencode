from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_server_instance_disposed_type import EventServerInstanceDisposedType

if TYPE_CHECKING:
    from ..models.event_server_instance_disposed_properties import EventServerInstanceDisposedProperties


T = TypeVar("T", bound="EventServerInstanceDisposed")


@_attrs_define
class EventServerInstanceDisposed:
    """
    Attributes:
        id (str):
        type_ (EventServerInstanceDisposedType):
        properties (EventServerInstanceDisposedProperties):
    """

    id: str
    type_: EventServerInstanceDisposedType
    properties: EventServerInstanceDisposedProperties

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
        from ..models.event_server_instance_disposed_properties import EventServerInstanceDisposedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventServerInstanceDisposedType(d.pop("type"))

        properties = EventServerInstanceDisposedProperties.from_dict(d.pop("properties"))

        event_server_instance_disposed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_server_instance_disposed
