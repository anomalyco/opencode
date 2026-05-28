from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ReferenceConfigEntryType1")


@_attrs_define
class ReferenceConfigEntryType1:
    """
    Attributes:
        repository (str): Git repository URL, host/path reference, or GitHub owner/repo shorthand
        branch (str | Unset):
    """

    repository: str
    branch: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        repository = self.repository

        branch = self.branch

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "repository": repository,
            }
        )
        if branch is not UNSET:
            field_dict["branch"] = branch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        repository = d.pop("repository")

        branch = d.pop("branch", UNSET)

        reference_config_entry_type_1 = cls(
            repository=repository,
            branch=branch,
        )

        return reference_config_entry_type_1
