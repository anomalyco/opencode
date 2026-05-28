from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_reasoning_delta_aggregate_id import SyncEventSessionNextReasoningDeltaAggregateID
from ..models.sync_event_session_next_reasoning_delta_name import SyncEventSessionNextReasoningDeltaName
from ..models.sync_event_session_next_reasoning_delta_type import SyncEventSessionNextReasoningDeltaType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_reasoning_delta_data import SyncEventSessionNextReasoningDeltaData


T = TypeVar("T", bound="SyncEventSessionNextReasoningDelta")


@_attrs_define
class SyncEventSessionNextReasoningDelta:
    """
    Attributes:
        type_ (SyncEventSessionNextReasoningDeltaType):
        name (SyncEventSessionNextReasoningDeltaName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextReasoningDeltaAggregateID):
        data (SyncEventSessionNextReasoningDeltaData):
    """

    type_: SyncEventSessionNextReasoningDeltaType
    name: SyncEventSessionNextReasoningDeltaName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextReasoningDeltaAggregateID
    data: SyncEventSessionNextReasoningDeltaData

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
        from ..models.sync_event_session_next_reasoning_delta_data import SyncEventSessionNextReasoningDeltaData

        d = dict(src_dict)
        type_ = SyncEventSessionNextReasoningDeltaType(d.pop("type"))

        name = SyncEventSessionNextReasoningDeltaName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextReasoningDeltaAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextReasoningDeltaData.from_dict(d.pop("data"))

        sync_event_session_next_reasoning_delta = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_reasoning_delta
