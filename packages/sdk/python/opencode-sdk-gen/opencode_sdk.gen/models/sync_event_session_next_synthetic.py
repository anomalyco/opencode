from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_synthetic_aggregate_id import SyncEventSessionNextSyntheticAggregateID
from ..models.sync_event_session_next_synthetic_name import SyncEventSessionNextSyntheticName
from ..models.sync_event_session_next_synthetic_type import SyncEventSessionNextSyntheticType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_synthetic_data import SyncEventSessionNextSyntheticData


T = TypeVar("T", bound="SyncEventSessionNextSynthetic")


@_attrs_define
class SyncEventSessionNextSynthetic:
    """
    Attributes:
        type_ (SyncEventSessionNextSyntheticType):
        name (SyncEventSessionNextSyntheticName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextSyntheticAggregateID):
        data (SyncEventSessionNextSyntheticData):
    """

    type_: SyncEventSessionNextSyntheticType
    name: SyncEventSessionNextSyntheticName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextSyntheticAggregateID
    data: SyncEventSessionNextSyntheticData

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
        from ..models.sync_event_session_next_synthetic_data import SyncEventSessionNextSyntheticData

        d = dict(src_dict)
        type_ = SyncEventSessionNextSyntheticType(d.pop("type"))

        name = SyncEventSessionNextSyntheticName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextSyntheticAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextSyntheticData.from_dict(d.pop("data"))

        sync_event_session_next_synthetic = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_synthetic
