from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_installation_updated_type import EventInstallationUpdatedType

if TYPE_CHECKING:
    from ..models.event_installation_updated_properties import EventInstallationUpdatedProperties


T = TypeVar("T", bound="EventInstallationUpdated")


@_attrs_define
class EventInstallationUpdated:
    """
    Attributes:
        id (str):
        type_ (EventInstallationUpdatedType):
        properties (EventInstallationUpdatedProperties):
    """

    id: str
    type_: EventInstallationUpdatedType
    properties: EventInstallationUpdatedProperties

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
        from ..models.event_installation_updated_properties import EventInstallationUpdatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventInstallationUpdatedType(d.pop("type"))

        properties = EventInstallationUpdatedProperties.from_dict(d.pop("properties"))

        event_installation_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_installation_updated
