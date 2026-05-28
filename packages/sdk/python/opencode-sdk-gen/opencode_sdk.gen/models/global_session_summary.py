from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.snapshot_file_diff import SnapshotFileDiff


T = TypeVar("T", bound="GlobalSessionSummary")


@_attrs_define
class GlobalSessionSummary:
    """
    Attributes:
        additions (float):
        deletions (float):
        files (float):
        diffs (list[SnapshotFileDiff] | Unset):
    """

    additions: float
    deletions: float
    files: float
    diffs: list[SnapshotFileDiff] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        additions = self.additions

        deletions = self.deletions

        files = self.files

        diffs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.diffs, Unset):
            diffs = []
            for diffs_item_data in self.diffs:
                diffs_item = diffs_item_data.to_dict()
                diffs.append(diffs_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "additions": additions,
                "deletions": deletions,
                "files": files,
            }
        )
        if diffs is not UNSET:
            field_dict["diffs"] = diffs

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.snapshot_file_diff import SnapshotFileDiff

        d = dict(src_dict)
        additions = d.pop("additions")

        deletions = d.pop("deletions")

        files = d.pop("files")

        _diffs = d.pop("diffs", UNSET)
        diffs: list[SnapshotFileDiff] | Unset = UNSET
        if _diffs is not UNSET:
            diffs = []
            for diffs_item_data in _diffs:
                diffs_item = SnapshotFileDiff.from_dict(diffs_item_data)

                diffs.append(diffs_item)

        global_session_summary = cls(
            additions=additions,
            deletions=deletions,
            files=files,
            diffs=diffs,
        )

        return global_session_summary
