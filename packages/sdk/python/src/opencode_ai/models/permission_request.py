from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_request_metadata import PermissionRequestMetadata
    from ..models.permission_request_tool import PermissionRequestTool


T = TypeVar("T", bound="PermissionRequest")


@_attrs_define
class PermissionRequest:
    """
    Attributes:
        id (str):
        session_id (str):
        permission (str):
        patterns (list[str]):
        metadata (PermissionRequestMetadata):
        always (list[str]):
        tool (PermissionRequestTool | Unset):
    """

    id: str
    session_id: str
    permission: str
    patterns: list[str]
    metadata: PermissionRequestMetadata
    always: list[str]
    tool: PermissionRequestTool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.permission_request_metadata import PermissionRequestMetadata
        from ..models.permission_request_tool import PermissionRequestTool

        id = self.id

        session_id = self.session_id

        permission = self.permission

        patterns = self.patterns

        metadata = self.metadata.to_dict()

        always = self.always

        tool: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool, Unset):
            tool = self.tool.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "permission": permission,
                "patterns": patterns,
                "metadata": metadata,
                "always": always,
            }
        )
        if tool is not UNSET:
            field_dict["tool"] = tool

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_request_metadata import PermissionRequestMetadata
        from ..models.permission_request_tool import PermissionRequestTool

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        permission = d.pop("permission")

        patterns = cast(list[str], d.pop("patterns"))

        metadata = PermissionRequestMetadata.from_dict(d.pop("metadata"))

        always = cast(list[str], d.pop("always"))

        _tool = d.pop("tool", UNSET)
        tool: PermissionRequestTool | Unset
        if isinstance(_tool, Unset):
            tool = UNSET
        else:
            tool = PermissionRequestTool.from_dict(_tool)

        permission_request = cls(
            id=id,
            session_id=session_id,
            permission=permission,
            patterns=patterns,
            metadata=metadata,
            always=always,
            tool=tool,
        )

        permission_request.additional_properties = d
        return permission_request

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
