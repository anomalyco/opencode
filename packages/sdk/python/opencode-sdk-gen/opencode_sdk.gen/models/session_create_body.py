from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_rule import PermissionRule
    from ..models.session_create_body_model import SessionCreateBodyModel


T = TypeVar("T", bound="SessionCreateBody")


@_attrs_define
class SessionCreateBody:
    """
    Attributes:
        parent_id (str | Unset):
        title (str | Unset):
        agent (str | Unset):
        model (SessionCreateBodyModel | Unset):
        permission (list[PermissionRule] | Unset):
        workspace_id (str | Unset):
    """

    parent_id: str | Unset = UNSET
    title: str | Unset = UNSET
    agent: str | Unset = UNSET
    model: SessionCreateBodyModel | Unset = UNSET
    permission: list[PermissionRule] | Unset = UNSET
    workspace_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        parent_id = self.parent_id

        title = self.title

        agent = self.agent

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        permission: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.permission, Unset):
            permission = []
            for componentsschemas_permission_ruleset_item_data in self.permission:
                componentsschemas_permission_ruleset_item = componentsschemas_permission_ruleset_item_data.to_dict()
                permission.append(componentsschemas_permission_ruleset_item)

        workspace_id = self.workspace_id

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if parent_id is not UNSET:
            field_dict["parentID"] = parent_id
        if title is not UNSET:
            field_dict["title"] = title
        if agent is not UNSET:
            field_dict["agent"] = agent
        if model is not UNSET:
            field_dict["model"] = model
        if permission is not UNSET:
            field_dict["permission"] = permission
        if workspace_id is not UNSET:
            field_dict["workspaceID"] = workspace_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_rule import PermissionRule
        from ..models.session_create_body_model import SessionCreateBodyModel

        d = dict(src_dict)
        parent_id = d.pop("parentID", UNSET)

        title = d.pop("title", UNSET)

        agent = d.pop("agent", UNSET)

        _model = d.pop("model", UNSET)
        model: SessionCreateBodyModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = SessionCreateBodyModel.from_dict(_model)

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
            agent=agent,
            model=model,
            permission=permission,
            workspace_id=workspace_id,
        )

        return session_create_body
