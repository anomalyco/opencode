from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SyncEventSessionUpdatedDataInfoRevertType0")


@_attrs_define
class SyncEventSessionUpdatedDataInfoRevertType0:
    """
    Attributes:
        message_id (str):
        part_id (str | Unset):
        snapshot (str | Unset):
        diff (str | Unset):
    """

    message_id: str
    part_id: str | Unset = UNSET
    snapshot: str | Unset = UNSET
    diff: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        message_id = self.message_id

        part_id = self.part_id

        snapshot = self.snapshot

        diff = self.diff

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "messageID": message_id,
            }
        )
        if part_id is not UNSET:
            field_dict["partID"] = part_id
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if diff is not UNSET:
            field_dict["diff"] = diff

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message_id = d.pop("messageID")

        part_id = d.pop("partID", UNSET)

        snapshot = d.pop("snapshot", UNSET)

        diff = d.pop("diff", UNSET)

        sync_event_session_updated_data_info_revert_type_0 = cls(
            message_id=message_id,
            part_id=part_id,
            snapshot=snapshot,
            diff=diff,
        )

        return sync_event_session_updated_data_info_revert_type_0
