from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_text_started_aggregate_id import SyncEventSessionNextTextStartedAggregateID
from ..models.sync_event_session_next_text_started_name import SyncEventSessionNextTextStartedName
from ..models.sync_event_session_next_text_started_type import SyncEventSessionNextTextStartedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_text_started_data import SyncEventSessionNextTextStartedData


T = TypeVar("T", bound="SyncEventSessionNextTextStarted")


@_attrs_define
class SyncEventSessionNextTextStarted:
    """
    Attributes:
        type_ (SyncEventSessionNextTextStartedType):
        name (SyncEventSessionNextTextStartedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextTextStartedAggregateID):
        data (SyncEventSessionNextTextStartedData):
    """

    type_: SyncEventSessionNextTextStartedType
    name: SyncEventSessionNextTextStartedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextTextStartedAggregateID
    data: SyncEventSessionNextTextStartedData

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
        from ..models.sync_event_session_next_text_started_data import SyncEventSessionNextTextStartedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextTextStartedType(d.pop("type"))

        name = SyncEventSessionNextTextStartedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextTextStartedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextTextStartedData.from_dict(d.pop("data"))

        sync_event_session_next_text_started = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_text_started
