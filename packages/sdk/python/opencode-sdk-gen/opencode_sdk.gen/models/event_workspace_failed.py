from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_workspace_failed_type import EventWorkspaceFailedType

if TYPE_CHECKING:
    from ..models.event_workspace_failed_properties import EventWorkspaceFailedProperties


T = TypeVar("T", bound="EventWorkspaceFailed")


@_attrs_define
class EventWorkspaceFailed:
    """
    Attributes:
        id (str):
        type_ (EventWorkspaceFailedType):
        properties (EventWorkspaceFailedProperties):
    """

    id: str
    type_: EventWorkspaceFailedType
    properties: EventWorkspaceFailedProperties

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
        from ..models.event_workspace_failed_properties import EventWorkspaceFailedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventWorkspaceFailedType(d.pop("type"))

        properties = EventWorkspaceFailedProperties.from_dict(d.pop("properties"))

        event_workspace_failed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_workspace_failed
