from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="McpAuthRemoveResponse200")


@_attrs_define
class McpAuthRemoveResponse200:
    """OAuth credentials removed

    Attributes:
        success (bool):
    """

    success: bool

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "success": success,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        success = d.pop("success")

        mcp_auth_remove_response_200 = cls(
            success=success,
        )

        return mcp_auth_remove_response_200
