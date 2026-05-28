from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.sync_replay_body_events_item import SyncReplayBodyEventsItem


T = TypeVar("T", bound="SyncReplayBody")


@_attrs_define
class SyncReplayBody:
    """
    Attributes:
        directory (str):
        events (list[SyncReplayBodyEventsItem]):
    """

    directory: str
    events: list[SyncReplayBodyEventsItem]

    def to_dict(self) -> dict[str, Any]:
        directory = self.directory

        events = []
        for events_item_data in self.events:
            events_item = events_item_data.to_dict()
            events.append(events_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "directory": directory,
                "events": events,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sync_replay_body_events_item import SyncReplayBodyEventsItem

        d = dict(src_dict)
        directory = d.pop("directory")

        events = []
        _events = d.pop("events")
        for events_item_data in _events:
            events_item = SyncReplayBodyEventsItem.from_dict(events_item_data)

            events.append(events_item)

        sync_replay_body = cls(
            directory=directory,
            events=events,
        )

        return sync_replay_body
