from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.event_file_watcher_updated_properties_event import EventFileWatcherUpdatedPropertiesEvent
from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        event = self.event.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        event_file_watcher_updated_properties.additional_properties = d
        return event_file_watcher_updated_properties

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
