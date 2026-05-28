from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.vcs_file_status_status import VcsFileStatusStatus

T = TypeVar("T", bound="VcsFileStatus")


@_attrs_define
class VcsFileStatus:
    """
    Attributes:
        file (str):
        additions (float):
        deletions (float):
        status (VcsFileStatusStatus):
    """

    file: str
    additions: float
    deletions: float
    status: VcsFileStatusStatus

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        additions = self.additions

        deletions = self.deletions

        status = self.status.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "file": file,
                "additions": additions,
                "deletions": deletions,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = d.pop("file")

        additions = d.pop("additions")

        deletions = d.pop("deletions")

        status = VcsFileStatusStatus(d.pop("status"))

        vcs_file_status = cls(
            file=file,
            additions=additions,
            deletions=deletions,
            status=status,
        )

        return vcs_file_status
