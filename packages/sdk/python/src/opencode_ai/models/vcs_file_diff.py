from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.vcs_file_diff_status import VcsFileDiffStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="VcsFileDiff")


@_attrs_define
class VcsFileDiff:
    """
    Attributes:
        file (str):
        patch (str):
        additions (int):
        deletions (int):
        status (VcsFileDiffStatus | Unset):
    """

    file: str
    patch: str
    additions: int
    deletions: int
    status: VcsFileDiffStatus | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        patch = self.patch

        additions = self.additions

        deletions = self.deletions

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "file": file,
                "patch": patch,
                "additions": additions,
                "deletions": deletions,
            }
        )
        if status is not UNSET:
            field_dict["status"] = status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = d.pop("file")

        patch = d.pop("patch")

        additions = d.pop("additions")

        deletions = d.pop("deletions")

        _status = d.pop("status", UNSET)
        status: VcsFileDiffStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = VcsFileDiffStatus(_status)

        vcs_file_diff = cls(
            file=file,
            patch=patch,
            additions=additions,
            deletions=deletions,
            status=status,
        )

        vcs_file_diff.additional_properties = d
        return vcs_file_diff

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
