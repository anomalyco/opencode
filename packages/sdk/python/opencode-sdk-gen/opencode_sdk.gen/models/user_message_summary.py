from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.snapshot_file_diff import SnapshotFileDiff


T = TypeVar("T", bound="UserMessageSummary")


@_attrs_define
class UserMessageSummary:
    """
    Attributes:
        diffs (list[SnapshotFileDiff]):
        title (str | Unset):
        body (str | Unset):
    """

    diffs: list[SnapshotFileDiff]
    title: str | Unset = UNSET
    body: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        diffs = []
        for diffs_item_data in self.diffs:
            diffs_item = diffs_item_data.to_dict()
            diffs.append(diffs_item)

        title = self.title

        body = self.body

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "diffs": diffs,
            }
        )
        if title is not UNSET:
            field_dict["title"] = title
        if body is not UNSET:
            field_dict["body"] = body

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.snapshot_file_diff import SnapshotFileDiff

        d = dict(src_dict)
        diffs = []
        _diffs = d.pop("diffs")
        for diffs_item_data in _diffs:
            diffs_item = SnapshotFileDiff.from_dict(diffs_item_data)

            diffs.append(diffs_item)

        title = d.pop("title", UNSET)

        body = d.pop("body", UNSET)

        user_message_summary = cls(
            diffs=diffs,
            title=title,
            body=body,
        )

        return user_message_summary
