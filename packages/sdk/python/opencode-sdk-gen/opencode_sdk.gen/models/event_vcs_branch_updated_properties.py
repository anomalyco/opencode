from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="EventVcsBranchUpdatedProperties")


@_attrs_define
class EventVcsBranchUpdatedProperties:
    """
    Attributes:
        branch (str | Unset):
    """

    branch: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        branch = self.branch

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if branch is not UNSET:
            field_dict["branch"] = branch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        branch = d.pop("branch", UNSET)

        event_vcs_branch_updated_properties = cls(
            branch=branch,
        )

        return event_vcs_branch_updated_properties
