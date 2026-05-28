from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventMcpToolsChangedProperties")


@_attrs_define
class EventMcpToolsChangedProperties:
    """
    Attributes:
        server (str):
    """

    server: str

    def to_dict(self) -> dict[str, Any]:
        server = self.server

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "server": server,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        server = d.pop("server")

        event_mcp_tools_changed_properties = cls(
            server=server,
        )

        return event_mcp_tools_changed_properties
