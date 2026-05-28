from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="VcsInfo")


@_attrs_define
class VcsInfo:
    """
    Attributes:
        branch (str | Unset):
        default_branch (str | Unset):
    """

    branch: str | Unset = UNSET
    default_branch: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        branch = self.branch

        default_branch = self.default_branch

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if branch is not UNSET:
            field_dict["branch"] = branch
        if default_branch is not UNSET:
            field_dict["default_branch"] = default_branch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        branch = d.pop("branch", UNSET)

        default_branch = d.pop("default_branch", UNSET)

        vcs_info = cls(
            branch=branch,
            default_branch=default_branch,
        )

        return vcs_info
