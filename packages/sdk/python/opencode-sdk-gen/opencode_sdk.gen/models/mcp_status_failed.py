from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.mcp_status_failed_status import MCPStatusFailedStatus

T = TypeVar("T", bound="MCPStatusFailed")


@_attrs_define
class MCPStatusFailed:
    """
    Attributes:
        status (MCPStatusFailedStatus):
        error (str):
    """

    status: MCPStatusFailedStatus
    error: str

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = MCPStatusFailedStatus(d.pop("status"))

        error = d.pop("error")

        mcp_status_failed = cls(
            status=status,
            error=error,
        )

        return mcp_status_failed
