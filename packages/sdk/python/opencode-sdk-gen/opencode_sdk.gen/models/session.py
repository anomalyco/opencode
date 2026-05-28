from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_rule import PermissionRule
    from ..models.session_model import SessionModel
    from ..models.session_revert import SessionRevert
    from ..models.session_share import SessionShare
    from ..models.session_summary import SessionSummary
    from ..models.session_time import SessionTime
    from ..models.session_tokens import SessionTokens


T = TypeVar("T", bound="Session")


@_attrs_define
class Session:
    """
    Attributes:
        id (str):
        slug (str):
        project_id (str):
        directory (str):
        title (str):
        version (str):
        time (SessionTime):
        workspace_id (str | Unset):
        path (str | Unset):
        parent_id (str | Unset):
        summary (SessionSummary | Unset):
        cost (float | Unset):
        tokens (SessionTokens | Unset):
        share (SessionShare | Unset):
        agent (str | Unset):
        model (SessionModel | Unset):
        permission (list[PermissionRule] | Unset):
        revert (SessionRevert | Unset):
    """

    id: str
    slug: str
    project_id: str
    directory: str
    title: str
    version: str
    time: SessionTime
    workspace_id: str | Unset = UNSET
    path: str | Unset = UNSET
    parent_id: str | Unset = UNSET
    summary: SessionSummary | Unset = UNSET
    cost: float | Unset = UNSET
    tokens: SessionTokens | Unset = UNSET
    share: SessionShare | Unset = UNSET
    agent: str | Unset = UNSET
    model: SessionModel | Unset = UNSET
    permission: list[PermissionRule] | Unset = UNSET
    revert: SessionRevert | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        slug = self.slug

        project_id = self.project_id

        directory = self.directory

        title = self.title

        version = self.version

        time = self.time.to_dict()

        workspace_id = self.workspace_id

        path = self.path

        parent_id = self.parent_id

        summary: dict[str, Any] | Unset = UNSET
        if not isinstance(self.summary, Unset):
            summary = self.summary.to_dict()

        cost = self.cost

        tokens: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tokens, Unset):
            tokens = self.tokens.to_dict()

        share: dict[str, Any] | Unset = UNSET
        if not isinstance(self.share, Unset):
            share = self.share.to_dict()

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

        revert: dict[str, Any] | Unset = UNSET
        if not isinstance(self.revert, Unset):
            revert = self.revert.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "projectID": project_id,
                "directory": directory,
                "title": title,
                "version": version,
                "time": time,
            }
        )
        if workspace_id is not UNSET:
            field_dict["workspaceID"] = workspace_id
        if path is not UNSET:
            field_dict["path"] = path
        if parent_id is not UNSET:
            field_dict["parentID"] = parent_id
        if summary is not UNSET:
            field_dict["summary"] = summary
        if cost is not UNSET:
            field_dict["cost"] = cost
        if tokens is not UNSET:
            field_dict["tokens"] = tokens
        if share is not UNSET:
            field_dict["share"] = share
        if agent is not UNSET:
            field_dict["agent"] = agent
        if model is not UNSET:
            field_dict["model"] = model
        if permission is not UNSET:
            field_dict["permission"] = permission
        if revert is not UNSET:
            field_dict["revert"] = revert

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_rule import PermissionRule
        from ..models.session_model import SessionModel
        from ..models.session_revert import SessionRevert
        from ..models.session_share import SessionShare
        from ..models.session_summary import SessionSummary
        from ..models.session_time import SessionTime
        from ..models.session_tokens import SessionTokens

        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        project_id = d.pop("projectID")

        directory = d.pop("directory")

        title = d.pop("title")

        version = d.pop("version")

        time = SessionTime.from_dict(d.pop("time"))

        workspace_id = d.pop("workspaceID", UNSET)

        path = d.pop("path", UNSET)

        parent_id = d.pop("parentID", UNSET)

        _summary = d.pop("summary", UNSET)
        summary: SessionSummary | Unset
        if isinstance(_summary, Unset):
            summary = UNSET
        else:
            summary = SessionSummary.from_dict(_summary)

        cost = d.pop("cost", UNSET)

        _tokens = d.pop("tokens", UNSET)
        tokens: SessionTokens | Unset
        if isinstance(_tokens, Unset):
            tokens = UNSET
        else:
            tokens = SessionTokens.from_dict(_tokens)

        _share = d.pop("share", UNSET)
        share: SessionShare | Unset
        if isinstance(_share, Unset):
            share = UNSET
        else:
            share = SessionShare.from_dict(_share)

        agent = d.pop("agent", UNSET)

        _model = d.pop("model", UNSET)
        model: SessionModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = SessionModel.from_dict(_model)

        _permission = d.pop("permission", UNSET)
        permission: list[PermissionRule] | Unset = UNSET
        if _permission is not UNSET:
            permission = []
            for componentsschemas_permission_ruleset_item_data in _permission:
                componentsschemas_permission_ruleset_item = PermissionRule.from_dict(
                    componentsschemas_permission_ruleset_item_data
                )

                permission.append(componentsschemas_permission_ruleset_item)

        _revert = d.pop("revert", UNSET)
        revert: SessionRevert | Unset
        if isinstance(_revert, Unset):
            revert = UNSET
        else:
            revert = SessionRevert.from_dict(_revert)

        session = cls(
            id=id,
            slug=slug,
            project_id=project_id,
            directory=directory,
            title=title,
            version=version,
            time=time,
            workspace_id=workspace_id,
            path=path,
            parent_id=parent_id,
            summary=summary,
            cost=cost,
            tokens=tokens,
            share=share,
            agent=agent,
            model=model,
            permission=permission,
            revert=revert,
        )

        return session
