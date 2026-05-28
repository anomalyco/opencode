from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_retried_aggregate_id import SyncEventSessionNextRetriedAggregateID
from ..models.sync_event_session_next_retried_name import SyncEventSessionNextRetriedName
from ..models.sync_event_session_next_retried_type import SyncEventSessionNextRetriedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_retried_data import SyncEventSessionNextRetriedData


T = TypeVar("T", bound="SyncEventSessionNextRetried")


@_attrs_define
class SyncEventSessionNextRetried:
    """
    Attributes:
        type_ (SyncEventSessionNextRetriedType):
        name (SyncEventSessionNextRetriedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextRetriedAggregateID):
        data (SyncEventSessionNextRetriedData):
    """

    type_: SyncEventSessionNextRetriedType
    name: SyncEventSessionNextRetriedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextRetriedAggregateID
    data: SyncEventSessionNextRetriedData

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
        from ..models.sync_event_session_next_retried_data import SyncEventSessionNextRetriedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextRetriedType(d.pop("type"))

        name = SyncEventSessionNextRetriedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextRetriedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextRetriedData.from_dict(d.pop("data"))

        sync_event_session_next_retried = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_retried
