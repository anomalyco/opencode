from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.workspace_time_used_type_1 import WorkspaceTimeUsedType1
from ..models.workspace_time_used_type_2 import WorkspaceTimeUsedType2
from ..models.workspace_time_used_type_3 import WorkspaceTimeUsedType3
from ..models.workspace_time_used_type_4 import WorkspaceTimeUsedType4
from ..types import UNSET, Unset

T = TypeVar("T", bound="Workspace")


@_attrs_define
class Workspace:
    """
    Attributes:
        id (str):
        type_ (str):
        name (str):
        project_id (str):
        time_used (float | WorkspaceTimeUsedType1 | WorkspaceTimeUsedType2 | WorkspaceTimeUsedType3 |
            WorkspaceTimeUsedType4):
        branch (None | str | Unset):
        directory (None | str | Unset):
        extra (Any | None | Unset):
    """

    id: str
    type_: str
    name: str
    project_id: str
    time_used: float | WorkspaceTimeUsedType1 | WorkspaceTimeUsedType2 | WorkspaceTimeUsedType3 | WorkspaceTimeUsedType4
    branch: None | str | Unset = UNSET
    directory: None | str | Unset = UNSET
    extra: Any | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        name = self.name

        project_id = self.project_id

        time_used: float | str
        if isinstance(self.time_used, WorkspaceTimeUsedType1):
            time_used = self.time_used.value
        elif isinstance(self.time_used, WorkspaceTimeUsedType2):
            time_used = self.time_used.value
        elif isinstance(self.time_used, WorkspaceTimeUsedType3):
            time_used = self.time_used.value
        elif isinstance(self.time_used, WorkspaceTimeUsedType4):
            time_used = self.time_used.value
        else:
            time_used = self.time_used

        branch: None | str | Unset
        if isinstance(self.branch, Unset):
            branch = UNSET
        else:
            branch = self.branch

        directory: None | str | Unset
        if isinstance(self.directory, Unset):
            directory = UNSET
        else:
            directory = self.directory

        extra: Any | None | Unset
        if isinstance(self.extra, Unset):
            extra = UNSET
        else:
            extra = self.extra

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "name": name,
                "projectID": project_id,
                "timeUsed": time_used,
            }
        )
        if branch is not UNSET:
            field_dict["branch"] = branch
        if directory is not UNSET:
            field_dict["directory"] = directory
        if extra is not UNSET:
            field_dict["extra"] = extra

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        type_ = d.pop("type")

        name = d.pop("name")

        project_id = d.pop("projectID")

        def _parse_time_used(
            data: object,
        ) -> float | WorkspaceTimeUsedType1 | WorkspaceTimeUsedType2 | WorkspaceTimeUsedType3 | WorkspaceTimeUsedType4:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                time_used_type_1 = WorkspaceTimeUsedType1(data)

                return time_used_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                time_used_type_2 = WorkspaceTimeUsedType2(data)

                return time_used_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                time_used_type_3 = WorkspaceTimeUsedType3(data)

                return time_used_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                time_used_type_4 = WorkspaceTimeUsedType4(data)

                return time_used_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                float
                | WorkspaceTimeUsedType1
                | WorkspaceTimeUsedType2
                | WorkspaceTimeUsedType3
                | WorkspaceTimeUsedType4,
                data,
            )

        time_used = _parse_time_used(d.pop("timeUsed"))

        def _parse_branch(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        branch = _parse_branch(d.pop("branch", UNSET))

        def _parse_directory(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        directory = _parse_directory(d.pop("directory", UNSET))

        def _parse_extra(data: object) -> Any | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | None | Unset, data)

        extra = _parse_extra(d.pop("extra", UNSET))

        workspace = cls(
            id=id,
            type_=type_,
            name=name,
            project_id=project_id,
            time_used=time_used,
            branch=branch,
            directory=directory,
            extra=extra,
        )

        return workspace
