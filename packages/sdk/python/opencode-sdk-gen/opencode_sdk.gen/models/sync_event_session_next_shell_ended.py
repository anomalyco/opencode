from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_shell_ended_aggregate_id import SyncEventSessionNextShellEndedAggregateID
from ..models.sync_event_session_next_shell_ended_name import SyncEventSessionNextShellEndedName
from ..models.sync_event_session_next_shell_ended_type import SyncEventSessionNextShellEndedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_shell_ended_data import SyncEventSessionNextShellEndedData


T = TypeVar("T", bound="SyncEventSessionNextShellEnded")


@_attrs_define
class SyncEventSessionNextShellEnded:
    """
    Attributes:
        type_ (SyncEventSessionNextShellEndedType):
        name (SyncEventSessionNextShellEndedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextShellEndedAggregateID):
        data (SyncEventSessionNextShellEndedData):
    """

    type_: SyncEventSessionNextShellEndedType
    name: SyncEventSessionNextShellEndedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextShellEndedAggregateID
    data: SyncEventSessionNextShellEndedData

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
        from ..models.sync_event_session_next_shell_ended_data import SyncEventSessionNextShellEndedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextShellEndedType(d.pop("type"))

        name = SyncEventSessionNextShellEndedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextShellEndedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextShellEndedData.from_dict(d.pop("data"))

        sync_event_session_next_shell_ended = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_shell_ended
