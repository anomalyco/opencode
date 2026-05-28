from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.sync_replay_body_events_item_data import SyncReplayBodyEventsItemData


T = TypeVar("T", bound="SyncReplayBodyEventsItem")


@_attrs_define
class SyncReplayBodyEventsItem:
    """
    Attributes:
        id (str):
        aggregate_id (str):
        seq (int):
        type_ (str):
        data (SyncReplayBodyEventsItemData):
    """

    id: str
    aggregate_id: str
    seq: int
    type_: str
    data: SyncReplayBodyEventsItemData

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        aggregate_id = self.aggregate_id

        seq = self.seq

        type_ = self.type_

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "aggregateID": aggregate_id,
                "seq": seq,
                "type": type_,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sync_replay_body_events_item_data import SyncReplayBodyEventsItemData

        d = dict(src_dict)
        id = d.pop("id")

        aggregate_id = d.pop("aggregateID")

        seq = d.pop("seq")

        type_ = d.pop("type")

        data = SyncReplayBodyEventsItemData.from_dict(d.pop("data"))

        sync_replay_body_events_item = cls(
            id=id,
            aggregate_id=aggregate_id,
            seq=seq,
            type_=type_,
            data=data,
        )

        return sync_replay_body_events_item
