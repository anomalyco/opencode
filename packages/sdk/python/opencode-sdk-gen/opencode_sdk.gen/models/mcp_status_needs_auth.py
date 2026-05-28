from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.mcp_status_needs_auth_status import MCPStatusNeedsAuthStatus

T = TypeVar("T", bound="MCPStatusNeedsAuth")


@_attrs_define
class MCPStatusNeedsAuth:
    """
    Attributes:
        status (MCPStatusNeedsAuthStatus):
    """

    status: MCPStatusNeedsAuthStatus

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = MCPStatusNeedsAuthStatus(d.pop("status"))

        mcp_status_needs_auth = cls(
            status=status,
        )

        return mcp_status_needs_auth
