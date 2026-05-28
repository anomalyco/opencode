from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_models_dev_refreshed_type import EventModelsDevRefreshedType

if TYPE_CHECKING:
    from ..models.event_models_dev_refreshed_properties import EventModelsDevRefreshedProperties


T = TypeVar("T", bound="EventModelsDevRefreshed")


@_attrs_define
class EventModelsDevRefreshed:
    """
    Attributes:
        id (str):
        type_ (EventModelsDevRefreshedType):
        properties (EventModelsDevRefreshedProperties):
    """

    id: str
    type_: EventModelsDevRefreshedType
    properties: EventModelsDevRefreshedProperties

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
        from ..models.event_models_dev_refreshed_properties import EventModelsDevRefreshedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventModelsDevRefreshedType(d.pop("type"))

        properties = EventModelsDevRefreshedProperties.from_dict(d.pop("properties"))

        event_models_dev_refreshed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_models_dev_refreshed
