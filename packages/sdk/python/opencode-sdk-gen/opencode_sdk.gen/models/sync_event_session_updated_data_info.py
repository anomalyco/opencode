from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_rule import PermissionRule
    from ..models.sync_event_session_updated_data_info_model_type_0 import SyncEventSessionUpdatedDataInfoModelType0
    from ..models.sync_event_session_updated_data_info_revert_type_0 import SyncEventSessionUpdatedDataInfoRevertType0
    from ..models.sync_event_session_updated_data_info_share import SyncEventSessionUpdatedDataInfoShare
    from ..models.sync_event_session_updated_data_info_summary_type_0 import SyncEventSessionUpdatedDataInfoSummaryType0
    from ..models.sync_event_session_updated_data_info_time import SyncEventSessionUpdatedDataInfoTime
    from ..models.sync_event_session_updated_data_info_tokens_type_0 import SyncEventSessionUpdatedDataInfoTokensType0


T = TypeVar("T", bound="SyncEventSessionUpdatedDataInfo")


@_attrs_define
class SyncEventSessionUpdatedDataInfo:
    """
    Attributes:
        id (None | str | Unset):
        slug (None | str | Unset):
        project_id (None | str | Unset):
        workspace_id (None | str | Unset):
        directory (None | str | Unset):
        path (None | str | Unset):
        parent_id (None | str | Unset):
        summary (None | SyncEventSessionUpdatedDataInfoSummaryType0 | Unset):
        cost (float | None | Unset):
        tokens (None | SyncEventSessionUpdatedDataInfoTokensType0 | Unset):
        share (SyncEventSessionUpdatedDataInfoShare | Unset):
        title (None | str | Unset):
        agent (None | str | Unset):
        model (None | SyncEventSessionUpdatedDataInfoModelType0 | Unset):
        version (None | str | Unset):
        time (SyncEventSessionUpdatedDataInfoTime | Unset):
        permission (list[PermissionRule] | None | Unset):
        revert (None | SyncEventSessionUpdatedDataInfoRevertType0 | Unset):
    """

    id: None | str | Unset = UNSET
    slug: None | str | Unset = UNSET
    project_id: None | str | Unset = UNSET
    workspace_id: None | str | Unset = UNSET
    directory: None | str | Unset = UNSET
    path: None | str | Unset = UNSET
    parent_id: None | str | Unset = UNSET
    summary: None | SyncEventSessionUpdatedDataInfoSummaryType0 | Unset = UNSET
    cost: float | None | Unset = UNSET
    tokens: None | SyncEventSessionUpdatedDataInfoTokensType0 | Unset = UNSET
    share: SyncEventSessionUpdatedDataInfoShare | Unset = UNSET
    title: None | str | Unset = UNSET
    agent: None | str | Unset = UNSET
    model: None | SyncEventSessionUpdatedDataInfoModelType0 | Unset = UNSET
    version: None | str | Unset = UNSET
    time: SyncEventSessionUpdatedDataInfoTime | Unset = UNSET
    permission: list[PermissionRule] | None | Unset = UNSET
    revert: None | SyncEventSessionUpdatedDataInfoRevertType0 | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.sync_event_session_updated_data_info_model_type_0 import SyncEventSessionUpdatedDataInfoModelType0
        from ..models.sync_event_session_updated_data_info_revert_type_0 import (
            SyncEventSessionUpdatedDataInfoRevertType0,
        )
        from ..models.sync_event_session_updated_data_info_summary_type_0 import (
            SyncEventSessionUpdatedDataInfoSummaryType0,
        )
        from ..models.sync_event_session_updated_data_info_tokens_type_0 import (
            SyncEventSessionUpdatedDataInfoTokensType0,
        )

        id: None | str | Unset
        if isinstance(self.id, Unset):
            id = UNSET
        else:
            id = self.id

        slug: None | str | Unset
        if isinstance(self.slug, Unset):
            slug = UNSET
        else:
            slug = self.slug

        project_id: None | str | Unset
        if isinstance(self.project_id, Unset):
            project_id = UNSET
        else:
            project_id = self.project_id

        workspace_id: None | str | Unset
        if isinstance(self.workspace_id, Unset):
            workspace_id = UNSET
        else:
            workspace_id = self.workspace_id

        directory: None | str | Unset
        if isinstance(self.directory, Unset):
            directory = UNSET
        else:
            directory = self.directory

        path: None | str | Unset
        if isinstance(self.path, Unset):
            path = UNSET
        else:
            path = self.path

        parent_id: None | str | Unset
        if isinstance(self.parent_id, Unset):
            parent_id = UNSET
        else:
            parent_id = self.parent_id

        summary: dict[str, Any] | None | Unset
        if isinstance(self.summary, Unset):
            summary = UNSET
        elif isinstance(self.summary, SyncEventSessionUpdatedDataInfoSummaryType0):
            summary = self.summary.to_dict()
        else:
            summary = self.summary

        cost: float | None | Unset
        if isinstance(self.cost, Unset):
            cost = UNSET
        else:
            cost = self.cost

        tokens: dict[str, Any] | None | Unset
        if isinstance(self.tokens, Unset):
            tokens = UNSET
        elif isinstance(self.tokens, SyncEventSessionUpdatedDataInfoTokensType0):
            tokens = self.tokens.to_dict()
        else:
            tokens = self.tokens

        share: dict[str, Any] | Unset = UNSET
        if not isinstance(self.share, Unset):
            share = self.share.to_dict()

        title: None | str | Unset
        if isinstance(self.title, Unset):
            title = UNSET
        else:
            title = self.title

        agent: None | str | Unset
        if isinstance(self.agent, Unset):
            agent = UNSET
        else:
            agent = self.agent

        model: dict[str, Any] | None | Unset
        if isinstance(self.model, Unset):
            model = UNSET
        elif isinstance(self.model, SyncEventSessionUpdatedDataInfoModelType0):
            model = self.model.to_dict()
        else:
            model = self.model

        version: None | str | Unset
        if isinstance(self.version, Unset):
            version = UNSET
        else:
            version = self.version

        time: dict[str, Any] | Unset = UNSET
        if not isinstance(self.time, Unset):
            time = self.time.to_dict()

        permission: list[dict[str, Any]] | None | Unset
        if isinstance(self.permission, Unset):
            permission = UNSET
        elif isinstance(self.permission, list):
            permission = []
            for componentsschemas_permission_ruleset_item_data in self.permission:
                componentsschemas_permission_ruleset_item = componentsschemas_permission_ruleset_item_data.to_dict()
                permission.append(componentsschemas_permission_ruleset_item)

        else:
            permission = self.permission

        revert: dict[str, Any] | None | Unset
        if isinstance(self.revert, Unset):
            revert = UNSET
        elif isinstance(self.revert, SyncEventSessionUpdatedDataInfoRevertType0):
            revert = self.revert.to_dict()
        else:
            revert = self.revert

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if slug is not UNSET:
            field_dict["slug"] = slug
        if project_id is not UNSET:
            field_dict["projectID"] = project_id
        if workspace_id is not UNSET:
            field_dict["workspaceID"] = workspace_id
        if directory is not UNSET:
            field_dict["directory"] = directory
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
        if title is not UNSET:
            field_dict["title"] = title
        if agent is not UNSET:
            field_dict["agent"] = agent
        if model is not UNSET:
            field_dict["model"] = model
        if version is not UNSET:
            field_dict["version"] = version
        if time is not UNSET:
            field_dict["time"] = time
        if permission is not UNSET:
            field_dict["permission"] = permission
        if revert is not UNSET:
            field_dict["revert"] = revert

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_rule import PermissionRule
        from ..models.sync_event_session_updated_data_info_model_type_0 import SyncEventSessionUpdatedDataInfoModelType0
        from ..models.sync_event_session_updated_data_info_revert_type_0 import (
            SyncEventSessionUpdatedDataInfoRevertType0,
        )
        from ..models.sync_event_session_updated_data_info_share import SyncEventSessionUpdatedDataInfoShare
        from ..models.sync_event_session_updated_data_info_summary_type_0 import (
            SyncEventSessionUpdatedDataInfoSummaryType0,
        )
        from ..models.sync_event_session_updated_data_info_time import SyncEventSessionUpdatedDataInfoTime
        from ..models.sync_event_session_updated_data_info_tokens_type_0 import (
            SyncEventSessionUpdatedDataInfoTokensType0,
        )

        d = dict(src_dict)

        def _parse_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        id = _parse_id(d.pop("id", UNSET))

        def _parse_slug(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        slug = _parse_slug(d.pop("slug", UNSET))

        def _parse_project_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        project_id = _parse_project_id(d.pop("projectID", UNSET))

        def _parse_workspace_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        workspace_id = _parse_workspace_id(d.pop("workspaceID", UNSET))

        def _parse_directory(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        directory = _parse_directory(d.pop("directory", UNSET))

        def _parse_path(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        path = _parse_path(d.pop("path", UNSET))

        def _parse_parent_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        parent_id = _parse_parent_id(d.pop("parentID", UNSET))

        def _parse_summary(data: object) -> None | SyncEventSessionUpdatedDataInfoSummaryType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                summary_type_0 = SyncEventSessionUpdatedDataInfoSummaryType0.from_dict(data)

                return summary_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SyncEventSessionUpdatedDataInfoSummaryType0 | Unset, data)

        summary = _parse_summary(d.pop("summary", UNSET))

        def _parse_cost(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cost = _parse_cost(d.pop("cost", UNSET))

        def _parse_tokens(data: object) -> None | SyncEventSessionUpdatedDataInfoTokensType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                tokens_type_0 = SyncEventSessionUpdatedDataInfoTokensType0.from_dict(data)

                return tokens_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SyncEventSessionUpdatedDataInfoTokensType0 | Unset, data)

        tokens = _parse_tokens(d.pop("tokens", UNSET))

        _share = d.pop("share", UNSET)
        share: SyncEventSessionUpdatedDataInfoShare | Unset
        if isinstance(_share, Unset):
            share = UNSET
        else:
            share = SyncEventSessionUpdatedDataInfoShare.from_dict(_share)

        def _parse_title(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        title = _parse_title(d.pop("title", UNSET))

        def _parse_agent(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        agent = _parse_agent(d.pop("agent", UNSET))

        def _parse_model(data: object) -> None | SyncEventSessionUpdatedDataInfoModelType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                model_type_0 = SyncEventSessionUpdatedDataInfoModelType0.from_dict(data)

                return model_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SyncEventSessionUpdatedDataInfoModelType0 | Unset, data)

        model = _parse_model(d.pop("model", UNSET))

        def _parse_version(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        version = _parse_version(d.pop("version", UNSET))

        _time = d.pop("time", UNSET)
        time: SyncEventSessionUpdatedDataInfoTime | Unset
        if isinstance(_time, Unset):
            time = UNSET
        else:
            time = SyncEventSessionUpdatedDataInfoTime.from_dict(_time)

        def _parse_permission(data: object) -> list[PermissionRule] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                permission_type_0 = []
                _permission_type_0 = data
                for componentsschemas_permission_ruleset_item_data in _permission_type_0:
                    componentsschemas_permission_ruleset_item = PermissionRule.from_dict(
                        componentsschemas_permission_ruleset_item_data
                    )

                    permission_type_0.append(componentsschemas_permission_ruleset_item)

                return permission_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[PermissionRule] | None | Unset, data)

        permission = _parse_permission(d.pop("permission", UNSET))

        def _parse_revert(data: object) -> None | SyncEventSessionUpdatedDataInfoRevertType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                revert_type_0 = SyncEventSessionUpdatedDataInfoRevertType0.from_dict(data)

                return revert_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SyncEventSessionUpdatedDataInfoRevertType0 | Unset, data)

        revert = _parse_revert(d.pop("revert", UNSET))

        sync_event_session_updated_data_info = cls(
            id=id,
            slug=slug,
            project_id=project_id,
            workspace_id=workspace_id,
            directory=directory,
            path=path,
            parent_id=parent_id,
            summary=summary,
            cost=cost,
            tokens=tokens,
            share=share,
            title=title,
            agent=agent,
            model=model,
            version=version,
            time=time,
            permission=permission,
            revert=revert,
        )

        return sync_event_session_updated_data_info
