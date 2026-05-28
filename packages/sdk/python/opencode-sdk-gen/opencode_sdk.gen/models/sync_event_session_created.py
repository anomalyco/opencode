from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_created_aggregate_id import SyncEventSessionCreatedAggregateID
from ..models.sync_event_session_created_name import SyncEventSessionCreatedName
from ..models.sync_event_session_created_type import SyncEventSessionCreatedType

if TYPE_CHECKING:
    from ..models.sync_event_session_created_data import SyncEventSessionCreatedData


T = TypeVar("T", bound="SyncEventSessionCreated")


@_attrs_define
class SyncEventSessionCreated:
    """
    Attributes:
        type_ (SyncEventSessionCreatedType):
        name (SyncEventSessionCreatedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionCreatedAggregateID):
        data (SyncEventSessionCreatedData):
    """

    type_: SyncEventSessionCreatedType
    name: SyncEventSessionCreatedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionCreatedAggregateID
    data: SyncEventSessionCreatedData

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
        from ..models.sync_event_session_created_data import SyncEventSessionCreatedData

        d = dict(src_dict)
        type_ = SyncEventSessionCreatedType(d.pop("type"))

        name = SyncEventSessionCreatedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionCreatedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionCreatedData.from_dict(d.pop("data"))

        sync_event_session_created = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_created
