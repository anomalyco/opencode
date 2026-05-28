from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_tool_called_aggregate_id import SyncEventSessionNextToolCalledAggregateID
from ..models.sync_event_session_next_tool_called_name import SyncEventSessionNextToolCalledName
from ..models.sync_event_session_next_tool_called_type import SyncEventSessionNextToolCalledType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_tool_called_data import SyncEventSessionNextToolCalledData


T = TypeVar("T", bound="SyncEventSessionNextToolCalled")


@_attrs_define
class SyncEventSessionNextToolCalled:
    """
    Attributes:
        type_ (SyncEventSessionNextToolCalledType):
        name (SyncEventSessionNextToolCalledName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextToolCalledAggregateID):
        data (SyncEventSessionNextToolCalledData):
    """

    type_: SyncEventSessionNextToolCalledType
    name: SyncEventSessionNextToolCalledName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextToolCalledAggregateID
    data: SyncEventSessionNextToolCalledData

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
        from ..models.sync_event_session_next_tool_called_data import SyncEventSessionNextToolCalledData

        d = dict(src_dict)
        type_ = SyncEventSessionNextToolCalledType(d.pop("type"))

        name = SyncEventSessionNextToolCalledName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextToolCalledAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextToolCalledData.from_dict(d.pop("data"))

        sync_event_session_next_tool_called = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_tool_called
