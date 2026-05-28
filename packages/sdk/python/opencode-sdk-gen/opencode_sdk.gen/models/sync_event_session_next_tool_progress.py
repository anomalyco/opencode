from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_tool_progress_aggregate_id import SyncEventSessionNextToolProgressAggregateID
from ..models.sync_event_session_next_tool_progress_name import SyncEventSessionNextToolProgressName
from ..models.sync_event_session_next_tool_progress_type import SyncEventSessionNextToolProgressType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_tool_progress_data import SyncEventSessionNextToolProgressData


T = TypeVar("T", bound="SyncEventSessionNextToolProgress")


@_attrs_define
class SyncEventSessionNextToolProgress:
    """
    Attributes:
        type_ (SyncEventSessionNextToolProgressType):
        name (SyncEventSessionNextToolProgressName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextToolProgressAggregateID):
        data (SyncEventSessionNextToolProgressData):
    """

    type_: SyncEventSessionNextToolProgressType
    name: SyncEventSessionNextToolProgressName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextToolProgressAggregateID
    data: SyncEventSessionNextToolProgressData

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
        from ..models.sync_event_session_next_tool_progress_data import SyncEventSessionNextToolProgressData

        d = dict(src_dict)
        type_ = SyncEventSessionNextToolProgressType(d.pop("type"))

        name = SyncEventSessionNextToolProgressName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextToolProgressAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextToolProgressData.from_dict(d.pop("data"))

        sync_event_session_next_tool_progress = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_tool_progress
