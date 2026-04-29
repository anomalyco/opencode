from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_rule import PermissionRule


T = TypeVar("T", bound="SessionCreateBody")


@_attrs_define
class SessionCreateBody:
    """
    Attributes:
        parent_id (str | Unset):
        title (str | Unset):
        permission (list[PermissionRule] | Unset):
        workspace_id (str | Unset):
    """

    parent_id: str | Unset = UNSET
    title: str | Unset = UNSET
    permission: list[PermissionRule] | Unset = UNSET
    workspace_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.permission_rule import PermissionRule

        parent_id = self.parent_id

        title = self.title

        permission: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.permission, Unset):
            permission = []
            for componentsschemas_permission_ruleset_item_data in self.permission:
                componentsschemas_permission_ruleset_item = componentsschemas_permission_ruleset_item_data.to_dict()
                permission.append(componentsschemas_permission_ruleset_item)

        workspace_id = self.workspace_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if parent_id is not UNSET:
            field_dict["parentID"] = parent_id
        if title is not UNSET:
            field_dict["title"] = title
        if permission is not UNSET:
            field_dict["permission"] = permission
        if workspace_id is not UNSET:
            field_dict["workspaceID"] = workspace_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_rule import PermissionRule

        d = dict(src_dict)
        parent_id = d.pop("parentID", UNSET)

        title = d.pop("title", UNSET)

        _permission = d.pop("permission", UNSET)
        permission: list[PermissionRule] | Unset = UNSET
        if _permission is not UNSET:
            permission = []
            for componentsschemas_permission_ruleset_item_data in _permission:
                componentsschemas_permission_ruleset_item = PermissionRule.from_dict(
                    componentsschemas_permission_ruleset_item_data
                )

                permission.append(componentsschemas_permission_ruleset_item)

        workspace_id = d.pop("workspaceID", UNSET)

        session_create_body = cls(
            parent_id=parent_id,
            title=title,
            permission=permission,
            workspace_id=workspace_id,
        )

        session_create_body.additional_properties = d
        return session_create_body

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
