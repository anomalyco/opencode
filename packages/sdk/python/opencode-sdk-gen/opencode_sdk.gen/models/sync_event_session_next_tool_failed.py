from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_tool_failed_aggregate_id import SyncEventSessionNextToolFailedAggregateID
from ..models.sync_event_session_next_tool_failed_name import SyncEventSessionNextToolFailedName
from ..models.sync_event_session_next_tool_failed_type import SyncEventSessionNextToolFailedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_tool_failed_data import SyncEventSessionNextToolFailedData


T = TypeVar("T", bound="SyncEventSessionNextToolFailed")


@_attrs_define
class SyncEventSessionNextToolFailed:
    """
    Attributes:
        type_ (SyncEventSessionNextToolFailedType):
        name (SyncEventSessionNextToolFailedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextToolFailedAggregateID):
        data (SyncEventSessionNextToolFailedData):
    """

    type_: SyncEventSessionNextToolFailedType
    name: SyncEventSessionNextToolFailedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextToolFailedAggregateID
    data: SyncEventSessionNextToolFailedData

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
        from ..models.sync_event_session_next_tool_failed_data import SyncEventSessionNextToolFailedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextToolFailedType(d.pop("type"))

        name = SyncEventSessionNextToolFailedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextToolFailedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextToolFailedData.from_dict(d.pop("data"))

        sync_event_session_next_tool_failed = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_tool_failed
