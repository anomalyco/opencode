from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.snapshot_file_diff_status import SnapshotFileDiffStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="SnapshotFileDiff")


@_attrs_define
class SnapshotFileDiff:
    """
    Attributes:
        additions (float):
        deletions (float):
        file (str | Unset):
        patch (str | Unset):
        status (SnapshotFileDiffStatus | Unset):
    """

    additions: float
    deletions: float
    file: str | Unset = UNSET
    patch: str | Unset = UNSET
    status: SnapshotFileDiffStatus | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        additions = self.additions

        deletions = self.deletions

        file = self.file

        patch = self.patch

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "additions": additions,
                "deletions": deletions,
            }
        )
        if file is not UNSET:
            field_dict["file"] = file
        if patch is not UNSET:
            field_dict["patch"] = patch
        if status is not UNSET:
            field_dict["status"] = status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        additions = d.pop("additions")

        deletions = d.pop("deletions")

        file = d.pop("file", UNSET)

        patch = d.pop("patch", UNSET)

        _status = d.pop("status", UNSET)
        status: SnapshotFileDiffStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = SnapshotFileDiffStatus(_status)

        snapshot_file_diff = cls(
            additions=additions,
            deletions=deletions,
            file=file,
            patch=patch,
            status=status,
        )

        return snapshot_file_diff
