from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_file_watcher_updated_properties_event import EventFileWatcherUpdatedPropertiesEvent

T = TypeVar("T", bound="EventFileWatcherUpdatedProperties")


@_attrs_define
class EventFileWatcherUpdatedProperties:
    """
    Attributes:
        file (str):
        event (EventFileWatcherUpdatedPropertiesEvent):
    """

    file: str
    event: EventFileWatcherUpdatedPropertiesEvent

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        event = self.event.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "file": file,
                "event": event,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = d.pop("file")

        event = EventFileWatcherUpdatedPropertiesEvent(d.pop("event"))

        event_file_watcher_updated_properties = cls(
            file=file,
            event=event,
        )

        return event_file_watcher_updated_properties
