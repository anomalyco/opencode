from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_mcp_browser_open_failed_type import EventMcpBrowserOpenFailedType

if TYPE_CHECKING:
    from ..models.event_mcp_browser_open_failed_properties import EventMcpBrowserOpenFailedProperties


T = TypeVar("T", bound="EventMcpBrowserOpenFailed")


@_attrs_define
class EventMcpBrowserOpenFailed:
    """
    Attributes:
        id (str):
        type_ (EventMcpBrowserOpenFailedType):
        properties (EventMcpBrowserOpenFailedProperties):
    """

    id: str
    type_: EventMcpBrowserOpenFailedType
    properties: EventMcpBrowserOpenFailedProperties

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_.value

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_mcp_browser_open_failed_properties import EventMcpBrowserOpenFailedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventMcpBrowserOpenFailedType(d.pop("type"))

        properties = EventMcpBrowserOpenFailedProperties.from_dict(d.pop("properties"))

        event_mcp_browser_open_failed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_mcp_browser_open_failed
