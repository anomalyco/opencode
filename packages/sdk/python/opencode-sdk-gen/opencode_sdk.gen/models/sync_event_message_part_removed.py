from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_message_part_removed_aggregate_id import SyncEventMessagePartRemovedAggregateID
from ..models.sync_event_message_part_removed_name import SyncEventMessagePartRemovedName
from ..models.sync_event_message_part_removed_type import SyncEventMessagePartRemovedType

if TYPE_CHECKING:
    from ..models.sync_event_message_part_removed_data import SyncEventMessagePartRemovedData


T = TypeVar("T", bound="SyncEventMessagePartRemoved")


@_attrs_define
class SyncEventMessagePartRemoved:
    """
    Attributes:
        type_ (SyncEventMessagePartRemovedType):
        name (SyncEventMessagePartRemovedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventMessagePartRemovedAggregateID):
        data (SyncEventMessagePartRemovedData):
    """

    type_: SyncEventMessagePartRemovedType
    name: SyncEventMessagePartRemovedName
    id: str
    seq: float
    aggregate_id: SyncEventMessagePartRemovedAggregateID
    data: SyncEventMessagePartRemovedData

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
        from ..models.sync_event_message_part_removed_data import SyncEventMessagePartRemovedData

        d = dict(src_dict)
        type_ = SyncEventMessagePartRemovedType(d.pop("type"))

        name = SyncEventMessagePartRemovedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventMessagePartRemovedAggregateID(d.pop("aggregateID"))

        data = SyncEventMessagePartRemovedData.from_dict(d.pop("data"))

        sync_event_message_part_removed = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_message_part_removed
