from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_compaction_delta_aggregate_id import (
    SyncEventSessionNextCompactionDeltaAggregateID,
)
from ..models.sync_event_session_next_compaction_delta_name import SyncEventSessionNextCompactionDeltaName
from ..models.sync_event_session_next_compaction_delta_type import SyncEventSessionNextCompactionDeltaType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_compaction_delta_data import SyncEventSessionNextCompactionDeltaData


T = TypeVar("T", bound="SyncEventSessionNextCompactionDelta")


@_attrs_define
class SyncEventSessionNextCompactionDelta:
    """
    Attributes:
        type_ (SyncEventSessionNextCompactionDeltaType):
        name (SyncEventSessionNextCompactionDeltaName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextCompactionDeltaAggregateID):
        data (SyncEventSessionNextCompactionDeltaData):
    """

    type_: SyncEventSessionNextCompactionDeltaType
    name: SyncEventSessionNextCompactionDeltaName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextCompactionDeltaAggregateID
    data: SyncEventSessionNextCompactionDeltaData

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
        from ..models.sync_event_session_next_compaction_delta_data import SyncEventSessionNextCompactionDeltaData

        d = dict(src_dict)
        type_ = SyncEventSessionNextCompactionDeltaType(d.pop("type"))

        name = SyncEventSessionNextCompactionDeltaName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextCompactionDeltaAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextCompactionDeltaData.from_dict(d.pop("data"))

        sync_event_session_next_compaction_delta = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_compaction_delta
