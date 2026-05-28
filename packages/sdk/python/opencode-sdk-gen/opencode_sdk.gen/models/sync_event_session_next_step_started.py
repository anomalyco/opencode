from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_step_started_aggregate_id import SyncEventSessionNextStepStartedAggregateID
from ..models.sync_event_session_next_step_started_name import SyncEventSessionNextStepStartedName
from ..models.sync_event_session_next_step_started_type import SyncEventSessionNextStepStartedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_step_started_data import SyncEventSessionNextStepStartedData


T = TypeVar("T", bound="SyncEventSessionNextStepStarted")


@_attrs_define
class SyncEventSessionNextStepStarted:
    """
    Attributes:
        type_ (SyncEventSessionNextStepStartedType):
        name (SyncEventSessionNextStepStartedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextStepStartedAggregateID):
        data (SyncEventSessionNextStepStartedData):
    """

    type_: SyncEventSessionNextStepStartedType
    name: SyncEventSessionNextStepStartedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextStepStartedAggregateID
    data: SyncEventSessionNextStepStartedData

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
        from ..models.sync_event_session_next_step_started_data import SyncEventSessionNextStepStartedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextStepStartedType(d.pop("type"))

        name = SyncEventSessionNextStepStartedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextStepStartedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextStepStartedData.from_dict(d.pop("data"))

        sync_event_session_next_step_started = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_step_started
