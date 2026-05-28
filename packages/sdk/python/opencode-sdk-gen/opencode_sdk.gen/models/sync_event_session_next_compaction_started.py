from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_compaction_started_aggregate_id import (
    SyncEventSessionNextCompactionStartedAggregateID,
)
from ..models.sync_event_session_next_compaction_started_name import SyncEventSessionNextCompactionStartedName
from ..models.sync_event_session_next_compaction_started_type import SyncEventSessionNextCompactionStartedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_compaction_started_data import SyncEventSessionNextCompactionStartedData


T = TypeVar("T", bound="SyncEventSessionNextCompactionStarted")


@_attrs_define
class SyncEventSessionNextCompactionStarted:
    """
    Attributes:
        type_ (SyncEventSessionNextCompactionStartedType):
        name (SyncEventSessionNextCompactionStartedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextCompactionStartedAggregateID):
        data (SyncEventSessionNextCompactionStartedData):
    """

    type_: SyncEventSessionNextCompactionStartedType
    name: SyncEventSessionNextCompactionStartedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextCompactionStartedAggregateID
    data: SyncEventSessionNextCompactionStartedData

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        name = self.name.value

        id = self.id

        seq = self.seq

        aggregate_id = self.aggregate_id.value

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "name": name,
                "id": id,
                "seq": seq,
                "aggregateID": aggregate_id,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sync_event_session_next_compaction_started_data import SyncEventSessionNextCompactionStartedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextCompactionStartedType(d.pop("type"))

        name = SyncEventSessionNextCompactionStartedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextCompactionStartedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextCompactionStartedData.from_dict(d.pop("data"))

        sync_event_session_next_compaction_started = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_compaction_started
