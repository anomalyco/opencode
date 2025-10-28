from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="SnapshotPart")


@_attrs_define
class SnapshotPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (Literal['snapshot']):
        snapshot (str):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["snapshot"]
    snapshot: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        snapshot = self.snapshot

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "snapshot": snapshot,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = cast(Literal["snapshot"], d.pop("type"))
        if type_ != "snapshot":
            raise ValueError(f"type must match const 'snapshot', got '{type_}'")

        snapshot = d.pop("snapshot")

        snapshot_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            snapshot=snapshot,
        )

        snapshot_part.additional_properties = d
        return snapshot_part

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
