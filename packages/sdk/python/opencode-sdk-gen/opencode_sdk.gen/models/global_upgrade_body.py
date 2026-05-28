from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GlobalUpgradeBody")


@_attrs_define
class GlobalUpgradeBody:
    """
    Attributes:
        target (str | Unset):
    """

    target: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        target = self.target

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if target is not UNSET:
            field_dict["target"] = target

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        target = d.pop("target", UNSET)

        global_upgrade_body = cls(
            target=target,
        )

        return global_upgrade_body
