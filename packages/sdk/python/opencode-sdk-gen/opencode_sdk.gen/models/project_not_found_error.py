from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.project_not_found_error_tag import ProjectNotFoundErrorTag

T = TypeVar("T", bound="ProjectNotFoundError")


@_attrs_define
class ProjectNotFoundError:
    """
    Attributes:
        field_tag (ProjectNotFoundErrorTag):
        project_id (str):
        message (str):
    """

    field_tag: ProjectNotFoundErrorTag
    project_id: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        project_id = self.project_id

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "projectID": project_id,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = ProjectNotFoundErrorTag(d.pop("_tag"))

        project_id = d.pop("projectID")

        message = d.pop("message")

        project_not_found_error = cls(
            field_tag=field_tag,
            project_id=project_id,
            message=message,
        )

        return project_not_found_error
