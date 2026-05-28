from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_mcp_tools_changed_type import EventMcpToolsChangedType

if TYPE_CHECKING:
    from ..models.event_mcp_tools_changed_properties import EventMcpToolsChangedProperties


T = TypeVar("T", bound="EventMcpToolsChanged")


@_attrs_define
class EventMcpToolsChanged:
    """
    Attributes:
        id (str):
        type_ (EventMcpToolsChangedType):
        properties (EventMcpToolsChangedProperties):
    """

    id: str
    type_: EventMcpToolsChangedType
    properties: EventMcpToolsChangedProperties

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
        from ..models.event_mcp_tools_changed_properties import EventMcpToolsChangedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventMcpToolsChangedType(d.pop("type"))

        properties = EventMcpToolsChangedProperties.from_dict(d.pop("properties"))

        event_mcp_tools_changed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_mcp_tools_changed
