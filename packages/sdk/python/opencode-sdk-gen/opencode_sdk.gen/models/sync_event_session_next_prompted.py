from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.sync_event_session_next_prompted_aggregate_id import SyncEventSessionNextPromptedAggregateID
from ..models.sync_event_session_next_prompted_name import SyncEventSessionNextPromptedName
from ..models.sync_event_session_next_prompted_type import SyncEventSessionNextPromptedType

if TYPE_CHECKING:
    from ..models.sync_event_session_next_prompted_data import SyncEventSessionNextPromptedData


T = TypeVar("T", bound="SyncEventSessionNextPrompted")


@_attrs_define
class SyncEventSessionNextPrompted:
    """
    Attributes:
        type_ (SyncEventSessionNextPromptedType):
        name (SyncEventSessionNextPromptedName):
        id (str):
        seq (float):
        aggregate_id (SyncEventSessionNextPromptedAggregateID):
        data (SyncEventSessionNextPromptedData):
    """

    type_: SyncEventSessionNextPromptedType
    name: SyncEventSessionNextPromptedName
    id: str
    seq: float
    aggregate_id: SyncEventSessionNextPromptedAggregateID
    data: SyncEventSessionNextPromptedData

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
        from ..models.sync_event_session_next_prompted_data import SyncEventSessionNextPromptedData

        d = dict(src_dict)
        type_ = SyncEventSessionNextPromptedType(d.pop("type"))

        name = SyncEventSessionNextPromptedName(d.pop("name"))

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = SyncEventSessionNextPromptedAggregateID(d.pop("aggregateID"))

        data = SyncEventSessionNextPromptedData.from_dict(d.pop("data"))

        sync_event_session_next_prompted = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        return sync_event_session_next_prompted
