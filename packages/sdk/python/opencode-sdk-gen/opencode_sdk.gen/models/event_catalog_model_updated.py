from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_catalog_model_updated_type import EventCatalogModelUpdatedType

if TYPE_CHECKING:
    from ..models.event_catalog_model_updated_properties import EventCatalogModelUpdatedProperties


T = TypeVar("T", bound="EventCatalogModelUpdated")


@_attrs_define
class EventCatalogModelUpdated:
    """
    Attributes:
        id (str):
        type_ (EventCatalogModelUpdatedType):
        properties (EventCatalogModelUpdatedProperties):
    """

    id: str
    type_: EventCatalogModelUpdatedType
    properties: EventCatalogModelUpdatedProperties

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
        from ..models.event_catalog_model_updated_properties import EventCatalogModelUpdatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventCatalogModelUpdatedType(d.pop("type"))

        properties = EventCatalogModelUpdatedProperties.from_dict(d.pop("properties"))

        event_catalog_model_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_catalog_model_updated
