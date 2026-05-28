from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="VcsApplyResponse200")


@_attrs_define
class VcsApplyResponse200:
    """VCS patch applied

    Attributes:
        applied (bool):
    """

    applied: bool

    def to_dict(self) -> dict[str, Any]:
        applied = self.applied

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "applied": applied,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        applied = d.pop("applied")

        vcs_apply_response_200 = cls(
            applied=applied,
        )

        return vcs_apply_response_200
