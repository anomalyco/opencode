from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_model_switched_aggregate_id import SyncEventSessionNextModelSwitchedAggregateID
from ..models.sync_event_session_next_model_switched_name import SyncEventSessionNextModelSwitchedName
from ..models.sync_event_session_next_model_switched_type import SyncEventSessionNextModelSwitchedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_model_switched_data import SyncEventSessionNextModelSwitchedData


T = TypeVar("T", bound="SyncEventSessionNextModelSwitched")


@_attrs_define
class SyncEventSessionNextModelSwitched:
    """
    Attributes:
        type_ (SyncEventSessionNextModelSwitchedType):
        name (SyncEventSessionNextModelSwitchedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextModelSwitchedAggregateID):
        data (SyncEventSessionNextModelSwitchedData):
    """

    type_: SyncEventSessionNextModelSwitchedType
    name: SyncEventSessionNextModelSwitchedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextModelSwitchedAggregateID
    data: SyncEventSessionNextModelSwitchedData

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
        from ..models.sync_event_session_next_model_switched_data import SyncEventSessionNextModelSwitchedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextModelSwitchedType(d.pop("type"))

        name = SyncEventSessionNextModelSwitchedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextModelSwitchedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextModelSwitchedData.from_dict(d.pop("data"))

        sync_event_session_next_model_switched = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_model_switched
