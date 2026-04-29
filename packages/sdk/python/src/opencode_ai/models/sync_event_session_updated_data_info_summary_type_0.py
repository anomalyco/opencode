from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.snapshot_file_diff import SnapshotFileDiff


T = TypeVar("T", bound="SyncEventSessionUpdatedDataInfoSummaryType0")


@_attrs_define
class SyncEventSessionUpdatedDataInfoSummaryType0:
    """
    Attributes:
        additions (int):
        deletions (int):
        files (int):
        diffs (list[SnapshotFileDiff] | Unset):
    """

    additions: int
    deletions: int
    files: int
    diffs: list[SnapshotFileDiff] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.snapshot_file_diff import SnapshotFileDiff

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
        field_dict.update(self.additional_properties)
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

        sync_event_session_updated_data_info_summary_type_0 = cls(
            additions=additions,
            deletions=deletions,
            files=files,
            diffs=diffs,
        )

        sync_event_session_updated_data_info_summary_type_0.additional_properties = d
        return sync_event_session_updated_data_info_summary_type_0

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
