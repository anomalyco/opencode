from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_mcp_browser_open_failed_properties import EventMcpBrowserOpenFailedProperties


T = TypeVar("T", bound="EventMcpBrowserOpenFailed")


@_attrs_define
class EventMcpBrowserOpenFailed:
    """
    Attributes:
        type_ (Literal['mcp.browser.open.failed']):
        properties (EventMcpBrowserOpenFailedProperties):
    """

    type_: Literal["mcp.browser.open.failed"]
    properties: EventMcpBrowserOpenFailedProperties
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.event_mcp_browser_open_failed_properties import EventMcpBrowserOpenFailedProperties

        type_ = self.type_

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_mcp_browser_open_failed_properties import EventMcpBrowserOpenFailedProperties

        d = dict(src_dict)
        type_ = cast(Literal["mcp.browser.open.failed"], d.pop("type"))
        if type_ != "mcp.browser.open.failed":
            raise ValueError(f"type must match const 'mcp.browser.open.failed', got '{type_}'")

        properties = EventMcpBrowserOpenFailedProperties.from_dict(d.pop("properties"))

        event_mcp_browser_open_failed = cls(
            type_=type_,
            properties=properties,
        )

        event_mcp_browser_open_failed.additional_properties = d
        return event_mcp_browser_open_failed

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
