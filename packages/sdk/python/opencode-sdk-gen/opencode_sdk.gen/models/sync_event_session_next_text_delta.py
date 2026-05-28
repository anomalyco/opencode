from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_text_delta_aggregate_id import SyncEventSessionNextTextDeltaAggregateID
from ..models.sync_event_session_next_text_delta_name import SyncEventSessionNextTextDeltaName
from ..models.sync_event_session_next_text_delta_type import SyncEventSessionNextTextDeltaType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_text_delta_data import SyncEventSessionNextTextDeltaData


T = TypeVar("T", bound="SyncEventSessionNextTextDelta")


@_attrs_define
class SyncEventSessionNextTextDelta:
    """
    Attributes:
        type_ (SyncEventSessionNextTextDeltaType):
        name (SyncEventSessionNextTextDeltaName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextTextDeltaAggregateID):
        data (SyncEventSessionNextTextDeltaData):
    """

    type_: SyncEventSessionNextTextDeltaType
    name: SyncEventSessionNextTextDeltaName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextTextDeltaAggregateID
    data: SyncEventSessionNextTextDeltaData

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
        from ..models.sync_event_session_next_text_delta_data import SyncEventSessionNextTextDeltaData

        d = dict(src_dict)
        type_ = SyncEventSessionNextTextDeltaType(d.pop("type"))

        name = SyncEventSessionNextTextDeltaName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextTextDeltaAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextTextDeltaData.from_dict(d.pop("data"))

        sync_event_session_next_text_delta = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_text_delta
