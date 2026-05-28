from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_message_part_updated_aggregate_id import SyncEventMessagePartUpdatedAggregateID
from ..models.sync_event_message_part_updated_name import SyncEventMessagePartUpdatedName
from ..models.sync_event_message_part_updated_type import SyncEventMessagePartUpdatedType

if TYPE_CHECKING:
    from ..models.sync_event_message_part_updated_data import SyncEventMessagePartUpdatedData


T = TypeVar("T", bound="SyncEventMessagePartUpdated")


@_attrs_define
class SyncEventMessagePartUpdated:
    """
    Attributes:
        type_ (SyncEventMessagePartUpdatedType):
        name (SyncEventMessagePartUpdatedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventMessagePartUpdatedAggregateID):
        data (SyncEventMessagePartUpdatedData):
    """

    type_: SyncEventMessagePartUpdatedType
    name: SyncEventMessagePartUpdatedName
    id: str
    seq: float
    aggregate_id: SyncEventMessagePartUpdatedAggregateID
    data: SyncEventMessagePartUpdatedData

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
        from ..models.sync_event_message_part_updated_data import SyncEventMessagePartUpdatedData

        d = dict(src_dict)
        type_ = SyncEventMessagePartUpdatedType(d.pop("type"))

        name = SyncEventMessagePartUpdatedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventMessagePartUpdatedAggregateID(d.pop("aggregateID"))

        data = SyncEventMessagePartUpdatedData.from_dict(d.pop("data"))

        sync_event_message_part_updated = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_message_part_updated
