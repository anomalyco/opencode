from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_step_ended_aggregate_id import SyncEventSessionNextStepEndedAggregateID
from ..models.sync_event_session_next_step_ended_name import SyncEventSessionNextStepEndedName
from ..models.sync_event_session_next_step_ended_type import SyncEventSessionNextStepEndedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_step_ended_data import SyncEventSessionNextStepEndedData


T = TypeVar("T", bound="SyncEventSessionNextStepEnded")


@_attrs_define
class SyncEventSessionNextStepEnded:
    """
    Attributes:
        type_ (SyncEventSessionNextStepEndedType):
        name (SyncEventSessionNextStepEndedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextStepEndedAggregateID):
        data (SyncEventSessionNextStepEndedData):
    """

    type_: SyncEventSessionNextStepEndedType
    name: SyncEventSessionNextStepEndedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextStepEndedAggregateID
    data: SyncEventSessionNextStepEndedData

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
        from ..models.sync_event_session_next_step_ended_data import SyncEventSessionNextStepEndedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextStepEndedType(d.pop("type"))

        name = SyncEventSessionNextStepEndedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextStepEndedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextStepEndedData.from_dict(d.pop("data"))

        sync_event_session_next_step_ended = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_step_ended
