from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_tool_success_aggregate_id import SyncEventSessionNextToolSuccessAggregateID
from ..models.sync_event_session_next_tool_success_name import SyncEventSessionNextToolSuccessName
from ..models.sync_event_session_next_tool_success_type import SyncEventSessionNextToolSuccessType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_tool_success_data import SyncEventSessionNextToolSuccessData


T = TypeVar("T", bound="SyncEventSessionNextToolSuccess")


@_attrs_define
class SyncEventSessionNextToolSuccess:
    """
    Attributes:
        type_ (SyncEventSessionNextToolSuccessType):
        name (SyncEventSessionNextToolSuccessName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextToolSuccessAggregateID):
        data (SyncEventSessionNextToolSuccessData):
    """

    type_: SyncEventSessionNextToolSuccessType
    name: SyncEventSessionNextToolSuccessName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextToolSuccessAggregateID
    data: SyncEventSessionNextToolSuccessData

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
        from ..models.sync_event_session_next_tool_success_data import SyncEventSessionNextToolSuccessData

        d = dict(src_dict)
        type_ = SyncEventSessionNextToolSuccessType(d.pop("type"))

        name = SyncEventSessionNextToolSuccessName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextToolSuccessAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextToolSuccessData.from_dict(d.pop("data"))

        sync_event_session_next_tool_success = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_tool_success
