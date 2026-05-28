from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_workspace_status_properties_status import EventWorkspaceStatusPropertiesStatus

T = TypeVar("T", bound="EventWorkspaceStatusProperties")


@_attrs_define
class EventWorkspaceStatusProperties:
    """
    Attributes:
        workspace_id (str):
        status (EventWorkspaceStatusPropertiesStatus):
    """

    workspace_id: str
    status: EventWorkspaceStatusPropertiesStatus

    def to_dict(self) -> dict[str, Any]:
        workspace_id = self.workspace_id

        status = self.status.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "workspaceID": workspace_id,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        workspace_id = d.pop("workspaceID")

        status = EventWorkspaceStatusPropertiesStatus(d.pop("status"))

        event_workspace_status_properties = cls(
            workspace_id=workspace_id,
            status=status,
        )

        return event_workspace_status_properties
