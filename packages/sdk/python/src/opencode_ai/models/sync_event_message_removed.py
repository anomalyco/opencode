from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.sync_event_message_removed_data import SyncEventMessageRemovedData


T = TypeVar("T", bound="SyncEventMessageRemoved")


@_attrs_define
class SyncEventMessageRemoved:
    """
    Attributes:
        type_ (Literal['sync']):
        name (Literal['message.removed.1']):
        id (str):
        seq (float):
        aggregate_id (Literal['sessionID']):
        data (SyncEventMessageRemovedData):
    """

    type_: Literal["sync"]
    name: Literal["message.removed.1"]
    id: str
    seq: float
    aggregate_id: Literal["sessionID"]
    data: SyncEventMessageRemovedData
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.sync_event_message_removed_data import SyncEventMessageRemovedData

        type_ = self.type_

        name = self.name

        id = self.id

        seq = self.seq

        aggregate_id = self.aggregate_id

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.sync_event_message_removed_data import SyncEventMessageRemovedData

        d = dict(src_dict)
        type_ = cast(Literal["sync"], d.pop("type"))
        if type_ != "sync":
            raise ValueError(f"type must match const 'sync', got '{type_}'")

        name = cast(Literal["message.removed.1"], d.pop("name"))
        if name != "message.removed.1":
            raise ValueError(f"name must match const 'message.removed.1', got '{name}'")

        id = d.pop("id")

        seq = d.pop("seq")

        aggregate_id = cast(Literal["sessionID"], d.pop("aggregateID"))
        if aggregate_id != "sessionID":
            raise ValueError(f"aggregateID must match const 'sessionID', got '{aggregate_id}'")

        data = SyncEventMessageRemovedData.from_dict(d.pop("data"))

        sync_event_message_removed = cls(
            type_=type_,
            name=name,
            id=id,
            seq=seq,
            aggregate_id=aggregate_id,
            data=data,
        )

        sync_event_message_removed.additional_properties = d
        return sync_event_message_removed

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
