from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.mcp_status_disabled_status import MCPStatusDisabledStatus

T = TypeVar("T", bound="MCPStatusDisabled")


@_attrs_define
class MCPStatusDisabled:
    """
    Attributes:
        status (MCPStatusDisabledStatus):
    """

    status: MCPStatusDisabledStatus

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
        status = MCPStatusDisabledStatus(d.pop("status"))

        mcp_status_disabled = cls(
            status=status,
        )

        return mcp_status_disabled
