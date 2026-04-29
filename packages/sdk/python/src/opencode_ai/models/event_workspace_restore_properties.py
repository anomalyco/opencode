from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="EventWorkspaceRestoreProperties")


@_attrs_define
class EventWorkspaceRestoreProperties:
    """
    Attributes:
        workspace_id (str):
        session_id (str):
        total (int):
        step (int):
    """

    workspace_id: str
    session_id: str
    total: int
    step: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        workspace_id = self.workspace_id

        session_id = self.session_id

        total = self.total

        step = self.step

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "workspaceID": workspace_id,
                "sessionID": session_id,
                "total": total,
                "step": step,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        workspace_id = d.pop("workspaceID")

        session_id = d.pop("sessionID")

        total = d.pop("total")

        step = d.pop("step")

        event_workspace_restore_properties = cls(
            workspace_id=workspace_id,
            session_id=session_id,
            total=total,
            step=step,
        )

        event_workspace_restore_properties.additional_properties = d
        return event_workspace_restore_properties

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
