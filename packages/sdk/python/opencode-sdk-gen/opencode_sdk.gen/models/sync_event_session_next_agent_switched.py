from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_agent_switched_aggregate_id import SyncEventSessionNextAgentSwitchedAggregateID
from ..models.sync_event_session_next_agent_switched_name import SyncEventSessionNextAgentSwitchedName
from ..models.sync_event_session_next_agent_switched_type import SyncEventSessionNextAgentSwitchedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_agent_switched_data import SyncEventSessionNextAgentSwitchedData


T = TypeVar("T", bound="SyncEventSessionNextAgentSwitched")


@_attrs_define
class SyncEventSessionNextAgentSwitched:
    """
    Attributes:
        type_ (SyncEventSessionNextAgentSwitchedType):
        name (SyncEventSessionNextAgentSwitchedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextAgentSwitchedAggregateID):
        data (SyncEventSessionNextAgentSwitchedData):
    """

    type_: SyncEventSessionNextAgentSwitchedType
    name: SyncEventSessionNextAgentSwitchedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextAgentSwitchedAggregateID
    data: SyncEventSessionNextAgentSwitchedData

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
        from ..models.sync_event_session_next_agent_switched_data import SyncEventSessionNextAgentSwitchedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextAgentSwitchedType(d.pop("type"))

        name = SyncEventSessionNextAgentSwitchedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextAgentSwitchedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextAgentSwitchedData.from_dict(d.pop("data"))

        sync_event_session_next_agent_switched = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_agent_switched
