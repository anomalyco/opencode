from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GlobalUpgradeResponse200Type0")


@_attrs_define
class GlobalUpgradeResponse200Type0:
    """
    Attributes:
        success (bool):
        version (str):
    """

    success: bool
    version: str

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "success": success,
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        success = d.pop("success")

        version = d.pop("version")

        global_upgrade_response_200_type_0 = cls(
            success=success,
            version=version,
        )

        return global_upgrade_response_200_type_0
