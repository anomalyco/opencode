from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.vcs_file_diff_status import VcsFileDiffStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="VcsFileDiff")


@_attrs_define
class VcsFileDiff:
    """
    Attributes:
        file (str):
        additions (float):
        deletions (float):
        patch (str | Unset):
        status (VcsFileDiffStatus | Unset):
    """

    file: str
    additions: float
    deletions: float
    patch: str | Unset = UNSET
    status: VcsFileDiffStatus | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        additions = self.additions

        deletions = self.deletions

        patch = self.patch

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "file": file,
                "additions": additions,
                "deletions": deletions,
            }
        )
        if patch is not UNSET:
            field_dict["patch"] = patch
        if status is not UNSET:
            field_dict["status"] = status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = d.pop("file")

        additions = d.pop("additions")

        deletions = d.pop("deletions")

        patch = d.pop("patch", UNSET)

        _status = d.pop("status", UNSET)
        status: VcsFileDiffStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = VcsFileDiffStatus(_status)

        vcs_file_diff = cls(
            file=file,
            additions=additions,
            deletions=deletions,
            patch=patch,
            status=status,
        )

        return vcs_file_diff
