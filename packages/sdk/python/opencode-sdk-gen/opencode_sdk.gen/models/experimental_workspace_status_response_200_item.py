from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.experimental_workspace_status_response_200_item_status import (
    ExperimentalWorkspaceStatusResponse200ItemStatus,
)

T = TypeVar("T", bound="ExperimentalWorkspaceStatusResponse200Item")


@_attrs_define
class ExperimentalWorkspaceStatusResponse200Item:
    """
    Attributes:
        workspace_id (str):
        status (ExperimentalWorkspaceStatusResponse200ItemStatus):
    """

    workspace_id: str
    status: ExperimentalWorkspaceStatusResponse200ItemStatus

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

        status = ExperimentalWorkspaceStatusResponse200ItemStatus(d.pop("status"))

        experimental_workspace_status_response_200_item = cls(
            workspace_id=workspace_id,
            status=status,
        )

        return experimental_workspace_status_response_200_item
