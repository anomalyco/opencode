from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_file_watcher_updated_type import EventFileWatcherUpdatedType

if TYPE_CHECKING:
    from ..models.event_file_watcher_updated_properties import EventFileWatcherUpdatedProperties


T = TypeVar("T", bound="EventFileWatcherUpdated")


@_attrs_define
class EventFileWatcherUpdated:
    """
    Attributes:
        id (str):
        type_ (EventFileWatcherUpdatedType):
        properties (EventFileWatcherUpdatedProperties):
    """

    id: str
    type_: EventFileWatcherUpdatedType
    properties: EventFileWatcherUpdatedProperties

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
        from ..models.event_file_watcher_updated_properties import EventFileWatcherUpdatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventFileWatcherUpdatedType(d.pop("type"))

        properties = EventFileWatcherUpdatedProperties.from_dict(d.pop("properties"))

        event_file_watcher_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_file_watcher_updated
