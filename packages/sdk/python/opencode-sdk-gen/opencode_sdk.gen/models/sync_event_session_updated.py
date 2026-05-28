from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_updated_aggregate_id import SyncEventSessionUpdatedAggregateID
from ..models.sync_event_session_updated_name import SyncEventSessionUpdatedName
from ..models.sync_event_session_updated_type import SyncEventSessionUpdatedType

if TYPE_CHECKING:
    from ..models.sync_event_session_updated_data import SyncEventSessionUpdatedData


T = TypeVar("T", bound="SyncEventSessionUpdated")


@_attrs_define
class SyncEventSessionUpdated:
    """
    Attributes:
        type_ (SyncEventSessionUpdatedType):
        name (SyncEventSessionUpdatedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionUpdatedAggregateID):
        data (SyncEventSessionUpdatedData):
    """

    type_: SyncEventSessionUpdatedType
    name: SyncEventSessionUpdatedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionUpdatedAggregateID
    data: SyncEventSessionUpdatedData

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
        from ..models.sync_event_session_updated_data import SyncEventSessionUpdatedData

        d = dict(src_dict)
        type_ = SyncEventSessionUpdatedType(d.pop("type"))

        name = SyncEventSessionUpdatedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionUpdatedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionUpdatedData.from_dict(d.pop("data"))

        sync_event_session_updated = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_updated
