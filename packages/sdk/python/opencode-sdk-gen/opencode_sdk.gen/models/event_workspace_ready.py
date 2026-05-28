from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_workspace_ready_type import EventWorkspaceReadyType

if TYPE_CHECKING:
    from ..models.event_workspace_ready_properties import EventWorkspaceReadyProperties


T = TypeVar("T", bound="EventWorkspaceReady")


@_attrs_define
class EventWorkspaceReady:
    """
    Attributes:
        id (str):
        type_ (EventWorkspaceReadyType):
        properties (EventWorkspaceReadyProperties):
    """

    id: str
    type_: EventWorkspaceReadyType
    properties: EventWorkspaceReadyProperties

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
        from ..models.event_workspace_ready_properties import EventWorkspaceReadyProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventWorkspaceReadyType(d.pop("type"))

        properties = EventWorkspaceReadyProperties.from_dict(d.pop("properties"))

        event_workspace_ready = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_workspace_ready
