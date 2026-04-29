from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.experimental_workspace_status_response_200_item_status import (
    ExperimentalWorkspaceStatusResponse200ItemStatus,
)
from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        workspace_id = self.workspace_id

        status = self.status.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        experimental_workspace_status_response_200_item.additional_properties = d
        return experimental_workspace_status_response_200_item

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
