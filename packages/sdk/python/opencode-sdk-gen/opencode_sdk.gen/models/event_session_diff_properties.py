from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.snapshot_file_diff import SnapshotFileDiff


T = TypeVar("T", bound="EventSessionDiffProperties")


@_attrs_define
class EventSessionDiffProperties:
    """
    Attributes:
        session_id (str):
        diff (list[SnapshotFileDiff]):
    """

    session_id: str
    diff: list[SnapshotFileDiff]

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        diff = []
        for diff_item_data in self.diff:
            diff_item = diff_item_data.to_dict()
            diff.append(diff_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
                "diff": diff,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.snapshot_file_diff import SnapshotFileDiff

        d = dict(src_dict)
        session_id = d.pop("sessionID")

        diff = []
        _diff = d.pop("diff")
        for diff_item_data in _diff:
            diff_item = SnapshotFileDiff.from_dict(diff_item_data)

            diff.append(diff_item)

        event_session_diff_properties = cls(
            session_id=session_id,
            diff=diff,
        )

        return event_session_diff_properties
