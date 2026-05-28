from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_message_updated_aggregate_id import SyncEventMessageUpdatedAggregateID
from ..models.sync_event_message_updated_name import SyncEventMessageUpdatedName
from ..models.sync_event_message_updated_type import SyncEventMessageUpdatedType

if TYPE_CHECKING:
    from ..models.sync_event_message_updated_data import SyncEventMessageUpdatedData


T = TypeVar("T", bound="SyncEventMessageUpdated")


@_attrs_define
class SyncEventMessageUpdated:
    """
    Attributes:
        type_ (SyncEventMessageUpdatedType):
        name (SyncEventMessageUpdatedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventMessageUpdatedAggregateID):
        data (SyncEventMessageUpdatedData):
    """

    type_: SyncEventMessageUpdatedType
    name: SyncEventMessageUpdatedName
    id: str
    seq: float
    aggregate_id: SyncEventMessageUpdatedAggregateID
    data: SyncEventMessageUpdatedData

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
        from ..models.sync_event_message_updated_data import SyncEventMessageUpdatedData

        d = dict(src_dict)
        type_ = SyncEventMessageUpdatedType(d.pop("type"))

        name = SyncEventMessageUpdatedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventMessageUpdatedAggregateID(d.pop("aggregateID"))

        data = SyncEventMessageUpdatedData.from_dict(d.pop("data"))

        sync_event_message_updated = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_message_updated
