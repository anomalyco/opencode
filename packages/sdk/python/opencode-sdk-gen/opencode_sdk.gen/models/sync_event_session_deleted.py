from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_deleted_aggregate_id import SyncEventSessionDeletedAggregateID
from ..models.sync_event_session_deleted_name import SyncEventSessionDeletedName
from ..models.sync_event_session_deleted_type import SyncEventSessionDeletedType

if TYPE_CHECKING:
    from ..models.sync_event_session_deleted_data import SyncEventSessionDeletedData


T = TypeVar("T", bound="SyncEventSessionDeleted")


@_attrs_define
class SyncEventSessionDeleted:
    """
    Attributes:
        type_ (SyncEventSessionDeletedType):
        name (SyncEventSessionDeletedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionDeletedAggregateID):
        data (SyncEventSessionDeletedData):
    """

    type_: SyncEventSessionDeletedType
    name: SyncEventSessionDeletedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionDeletedAggregateID
    data: SyncEventSessionDeletedData

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
        from ..models.sync_event_session_deleted_data import SyncEventSessionDeletedData

        d = dict(src_dict)
        type_ = SyncEventSessionDeletedType(d.pop("type"))

        name = SyncEventSessionDeletedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionDeletedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionDeletedData.from_dict(d.pop("data"))

        sync_event_session_deleted = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_deleted
