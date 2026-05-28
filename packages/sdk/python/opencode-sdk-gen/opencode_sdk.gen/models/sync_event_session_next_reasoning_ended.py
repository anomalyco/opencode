from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_reasoning_ended_aggregate_id import SyncEventSessionNextReasoningEndedAggregateID
from ..models.sync_event_session_next_reasoning_ended_name import SyncEventSessionNextReasoningEndedName
from ..models.sync_event_session_next_reasoning_ended_type import SyncEventSessionNextReasoningEndedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_reasoning_ended_data import SyncEventSessionNextReasoningEndedData


T = TypeVar("T", bound="SyncEventSessionNextReasoningEnded")


@_attrs_define
class SyncEventSessionNextReasoningEnded:
    """
    Attributes:
        type_ (SyncEventSessionNextReasoningEndedType):
        name (SyncEventSessionNextReasoningEndedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextReasoningEndedAggregateID):
        data (SyncEventSessionNextReasoningEndedData):
    """

    type_: SyncEventSessionNextReasoningEndedType
    name: SyncEventSessionNextReasoningEndedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextReasoningEndedAggregateID
    data: SyncEventSessionNextReasoningEndedData

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
        from ..models.sync_event_session_next_reasoning_ended_data import SyncEventSessionNextReasoningEndedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextReasoningEndedType(d.pop("type"))

        name = SyncEventSessionNextReasoningEndedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextReasoningEndedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextReasoningEndedData.from_dict(d.pop("data"))

        sync_event_session_next_reasoning_ended = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_reasoning_ended
