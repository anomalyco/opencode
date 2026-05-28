from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_step_failed_aggregate_id import SyncEventSessionNextStepFailedAggregateID
from ..models.sync_event_session_next_step_failed_name import SyncEventSessionNextStepFailedName
from ..models.sync_event_session_next_step_failed_type import SyncEventSessionNextStepFailedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_step_failed_data import SyncEventSessionNextStepFailedData


T = TypeVar("T", bound="SyncEventSessionNextStepFailed")


@_attrs_define
class SyncEventSessionNextStepFailed:
    """
    Attributes:
        type_ (SyncEventSessionNextStepFailedType):
        name (SyncEventSessionNextStepFailedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextStepFailedAggregateID):
        data (SyncEventSessionNextStepFailedData):
    """

    type_: SyncEventSessionNextStepFailedType
    name: SyncEventSessionNextStepFailedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextStepFailedAggregateID
    data: SyncEventSessionNextStepFailedData

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
        from ..models.sync_event_session_next_step_failed_data import SyncEventSessionNextStepFailedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextStepFailedType(d.pop("type"))

        name = SyncEventSessionNextStepFailedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextStepFailedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextStepFailedData.from_dict(d.pop("data"))

        sync_event_session_next_step_failed = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_step_failed
