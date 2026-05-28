from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_tool_input_started_aggregate_id import (
    SyncEventSessionNextToolInputStartedAggregateID,
)
from ..models.sync_event_session_next_tool_input_started_name import SyncEventSessionNextToolInputStartedName
from ..models.sync_event_session_next_tool_input_started_type import SyncEventSessionNextToolInputStartedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_tool_input_started_data import SyncEventSessionNextToolInputStartedData


T = TypeVar("T", bound="SyncEventSessionNextToolInputStarted")


@_attrs_define
class SyncEventSessionNextToolInputStarted:
    """
    Attributes:
        type_ (SyncEventSessionNextToolInputStartedType):
        name (SyncEventSessionNextToolInputStartedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextToolInputStartedAggregateID):
        data (SyncEventSessionNextToolInputStartedData):
    """

    type_: SyncEventSessionNextToolInputStartedType
    name: SyncEventSessionNextToolInputStartedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextToolInputStartedAggregateID
    data: SyncEventSessionNextToolInputStartedData

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
        from ..models.sync_event_session_next_tool_input_started_data import SyncEventSessionNextToolInputStartedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextToolInputStartedType(d.pop("type"))

        name = SyncEventSessionNextToolInputStartedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextToolInputStartedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextToolInputStartedData.from_dict(d.pop("data"))

        sync_event_session_next_tool_input_started = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_tool_input_started
