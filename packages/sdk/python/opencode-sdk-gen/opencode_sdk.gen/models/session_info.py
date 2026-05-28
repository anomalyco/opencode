from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_info_model import SessionInfoModel
    from ..models.session_info_time import SessionInfoTime
    from ..models.session_info_tokens import SessionInfoTokens


T = TypeVar("T", bound="SessionInfo")


@_attrs_define
class SessionInfo:
    """
    Attributes:
        id (str):
        project_id (str):
        cost (float):
        tokens (SessionInfoTokens):
        time (SessionInfoTime):
        title (str):
        parent_id (str | Unset):
        workspace_id (str | Unset):
        path (str | Unset):
        agent (str | Unset):
        model (SessionInfoModel | Unset):
    """

    id: str
    project_id: str
    cost: float
    tokens: SessionInfoTokens
    time: SessionInfoTime
    title: str
    parent_id: str | Unset = UNSET
    workspace_id: str | Unset = UNSET
    path: str | Unset = UNSET
    agent: str | Unset = UNSET
    model: SessionInfoModel | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        project_id = self.project_id

        cost = self.cost

        tokens = self.tokens.to_dict()

        time = self.time.to_dict()

        title = self.title

        parent_id = self.parent_id

        workspace_id = self.workspace_id

        path = self.path

        agent = self.agent

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "projectID": project_id,
                "cost": cost,
                "tokens": tokens,
                "time": time,
                "title": title,
            }
        )
        if parent_id is not UNSET:
            field_dict["parentID"] = parent_id
        if workspace_id is not UNSET:
            field_dict["workspaceID"] = workspace_id
        if path is not UNSET:
            field_dict["path"] = path
        if agent is not UNSET:
            field_dict["agent"] = agent
        if model is not UNSET:
            field_dict["model"] = model

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_info_model import SessionInfoModel
        from ..models.session_info_time import SessionInfoTime
        from ..models.session_info_tokens import SessionInfoTokens

        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectID")

        cost = d.pop("cost")

        tokens = SessionInfoTokens.from_dict(d.pop("tokens"))

        time = SessionInfoTime.from_dict(d.pop("time"))

        title = d.pop("title")

        parent_id = d.pop("parentID", UNSET)

        workspace_id = d.pop("workspaceID", UNSET)

        path = d.pop("path", UNSET)

        agent = d.pop("agent", UNSET)

        _model = d.pop("model", UNSET)
        model: SessionInfoModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = SessionInfoModel.from_dict(_model)

        session_info = cls(
            id=id,
            project_id=project_id,
            cost=cost,
            tokens=tokens,
            time=time,
            title=title,
            parent_id=parent_id,
            workspace_id=workspace_id,
            path=path,
            agent=agent,
            model=model,
        )

        return session_info
