from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_message_removed_aggregate_id import SyncEventMessageRemovedAggregateID
from ..models.sync_event_message_removed_name import SyncEventMessageRemovedName
from ..models.sync_event_message_removed_type import SyncEventMessageRemovedType

if TYPE_CHECKING:
    from ..models.sync_event_message_removed_data import SyncEventMessageRemovedData


T = TypeVar("T", bound="SyncEventMessageRemoved")


@_attrs_define
class SyncEventMessageRemoved:
    """
    Attributes:
        type_ (SyncEventMessageRemovedType):
        name (SyncEventMessageRemovedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventMessageRemovedAggregateID):
        data (SyncEventMessageRemovedData):
    """

    type_: SyncEventMessageRemovedType
    name: SyncEventMessageRemovedName
    id: str
    seq: float
    aggregate_id: SyncEventMessageRemovedAggregateID
    data: SyncEventMessageRemovedData

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
        from ..models.sync_event_message_removed_data import SyncEventMessageRemovedData

        d = dict(src_dict)
        type_ = SyncEventMessageRemovedType(d.pop("type"))

        name = SyncEventMessageRemovedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventMessageRemovedAggregateID(d.pop("aggregateID"))

        data = SyncEventMessageRemovedData.from_dict(d.pop("data"))

        sync_event_message_removed = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_message_removed
