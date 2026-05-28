from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_workspace_status_type import EventWorkspaceStatusType

if TYPE_CHECKING:
    from ..models.event_workspace_status_properties import EventWorkspaceStatusProperties


T = TypeVar("T", bound="EventWorkspaceStatus")


@_attrs_define
class EventWorkspaceStatus:
    """
    Attributes:
        id (str):
        type_ (EventWorkspaceStatusType):
        properties (EventWorkspaceStatusProperties):
    """

    id: str
    type_: EventWorkspaceStatusType
    properties: EventWorkspaceStatusProperties

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
        from ..models.event_workspace_status_properties import EventWorkspaceStatusProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventWorkspaceStatusType(d.pop("type"))

        properties = EventWorkspaceStatusProperties.from_dict(d.pop("properties"))

        event_workspace_status = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_workspace_status
