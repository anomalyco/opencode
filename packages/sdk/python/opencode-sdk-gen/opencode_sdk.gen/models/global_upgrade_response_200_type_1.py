from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GlobalUpgradeResponse200Type1")


@_attrs_define
class GlobalUpgradeResponse200Type1:
    """
    Attributes:
        success (bool):
        error (str):
    """

    success: bool
    error: str

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "success": success,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        success = d.pop("success")

        error = d.pop("error")

        global_upgrade_response_200_type_1 = cls(
            success=success,
            error=error,
        )

        return global_upgrade_response_200_type_1
