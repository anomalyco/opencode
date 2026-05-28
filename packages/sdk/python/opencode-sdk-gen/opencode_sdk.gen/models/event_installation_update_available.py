from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_installation_update_available_type import EventInstallationUpdateAvailableType

if TYPE_CHECKING:
    from ..models.event_installation_update_available_properties import EventInstallationUpdateAvailableProperties


T = TypeVar("T", bound="EventInstallationUpdateAvailable")


@_attrs_define
class EventInstallationUpdateAvailable:
    """
    Attributes:
        id (str):
        type_ (EventInstallationUpdateAvailableType):
        properties (EventInstallationUpdateAvailableProperties):
    """

    id: str
    type_: EventInstallationUpdateAvailableType
    properties: EventInstallationUpdateAvailableProperties

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
        from ..models.event_installation_update_available_properties import EventInstallationUpdateAvailableProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventInstallationUpdateAvailableType(d.pop("type"))

        properties = EventInstallationUpdateAvailableProperties.from_dict(d.pop("properties"))

        event_installation_update_available = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_installation_update_available
