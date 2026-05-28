from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_text_ended_aggregate_id import SyncEventSessionNextTextEndedAggregateID
from ..models.sync_event_session_next_text_ended_name import SyncEventSessionNextTextEndedName
from ..models.sync_event_session_next_text_ended_type import SyncEventSessionNextTextEndedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_text_ended_data import SyncEventSessionNextTextEndedData


T = TypeVar("T", bound="SyncEventSessionNextTextEnded")


@_attrs_define
class SyncEventSessionNextTextEnded:
    """
    Attributes:
        type_ (SyncEventSessionNextTextEndedType):
        name (SyncEventSessionNextTextEndedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextTextEndedAggregateID):
        data (SyncEventSessionNextTextEndedData):
    """

    type_: SyncEventSessionNextTextEndedType
    name: SyncEventSessionNextTextEndedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextTextEndedAggregateID
    data: SyncEventSessionNextTextEndedData

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
        from ..models.sync_event_session_next_text_ended_data import SyncEventSessionNextTextEndedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextTextEndedType(d.pop("type"))

        name = SyncEventSessionNextTextEndedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextTextEndedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextTextEndedData.from_dict(d.pop("data"))

        sync_event_session_next_text_ended = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_text_ended
