from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.snapshot_part_type import SnapshotPartType

T = TypeVar("T", bound="SnapshotPart")


@_attrs_define
class SnapshotPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (SnapshotPartType):
        snapshot (str):
    """

    id: str
    session_id: str
    message_id: str
    type_: SnapshotPartType
    snapshot: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        snapshot = self.snapshot

        field_dict: dict[str, Any] = {}

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

        type_ = SnapshotPartType(d.pop("type"))

        snapshot = d.pop("snapshot")

        snapshot_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            snapshot=snapshot,
        )

        return snapshot_part
