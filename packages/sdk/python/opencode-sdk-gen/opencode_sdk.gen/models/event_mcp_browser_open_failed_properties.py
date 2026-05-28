from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventMcpBrowserOpenFailedProperties")


@_attrs_define
class EventMcpBrowserOpenFailedProperties:
    """
    Attributes:
        mcp_name (str):
        url (str):
    """

    mcp_name: str
    url: str

    def to_dict(self) -> dict[str, Any]:
        mcp_name = self.mcp_name

        url = self.url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "mcpName": mcp_name,
                "url": url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        mcp_name = d.pop("mcpName")

        url = d.pop("url")

        event_mcp_browser_open_failed_properties = cls(
            mcp_name=mcp_name,
            url=url,
        )

        return event_mcp_browser_open_failed_properties
