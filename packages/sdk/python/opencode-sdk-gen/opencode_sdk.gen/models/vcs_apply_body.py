from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="VcsApplyBody")


@_attrs_define
class VcsApplyBody:
    """
    Attributes:
        patch (str):
    """

    patch: str

    def to_dict(self) -> dict[str, Any]:
        patch = self.patch

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "patch": patch,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        patch = d.pop("patch")

        vcs_apply_body = cls(
            patch=patch,
        )

        return vcs_apply_body
