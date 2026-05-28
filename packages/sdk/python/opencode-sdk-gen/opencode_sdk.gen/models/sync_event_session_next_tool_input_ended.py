from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_tool_input_ended_aggregate_id import SyncEventSessionNextToolInputEndedAggregateID
from ..models.sync_event_session_next_tool_input_ended_name import SyncEventSessionNextToolInputEndedName
from ..models.sync_event_session_next_tool_input_ended_type import SyncEventSessionNextToolInputEndedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_tool_input_ended_data import SyncEventSessionNextToolInputEndedData


T = TypeVar("T", bound="SyncEventSessionNextToolInputEnded")


@_attrs_define
class SyncEventSessionNextToolInputEnded:
    """
    Attributes:
        type_ (SyncEventSessionNextToolInputEndedType):
        name (SyncEventSessionNextToolInputEndedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextToolInputEndedAggregateID):
        data (SyncEventSessionNextToolInputEndedData):
    """

    type_: SyncEventSessionNextToolInputEndedType
    name: SyncEventSessionNextToolInputEndedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextToolInputEndedAggregateID
    data: SyncEventSessionNextToolInputEndedData

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
        from ..models.sync_event_session_next_tool_input_ended_data import SyncEventSessionNextToolInputEndedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextToolInputEndedType(d.pop("type"))

        name = SyncEventSessionNextToolInputEndedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextToolInputEndedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextToolInputEndedData.from_dict(d.pop("data"))

        sync_event_session_next_tool_input_ended = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_tool_input_ended
