from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="Workspace")


@_attrs_define
class Workspace:
    """
    Attributes:
        id (str):
        type_ (str):
        name (str):
        branch (None | str):
        directory (None | str):
        extra (Any | None):
        project_id (str):
    """

    id: str
    type_: str
    name: str
    branch: None | str
    directory: None | str
    extra: Any | None
    project_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        name = self.name

        branch: None | str
        branch = self.branch

        directory: None | str
        directory = self.directory

        extra: Any | None
        extra = self.extra

        project_id = self.project_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "type": type_,
                "name": name,
                "branch": branch,
                "directory": directory,
                "extra": extra,
                "projectID": project_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        type_ = d.pop("type")

        name = d.pop("name")

        def _parse_branch(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        branch = _parse_branch(d.pop("branch"))

        def _parse_directory(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        directory = _parse_directory(d.pop("directory"))

        def _parse_extra(data: object) -> Any | None:
            if data is None:
                return data
            return cast(Any | None, data)

        extra = _parse_extra(d.pop("extra"))

        project_id = d.pop("projectID")

        workspace = cls(
            id=id,
            type_=type_,
            name=name,
            branch=branch,
            directory=directory,
            extra=extra,
            project_id=project_id,
        )

        workspace.additional_properties = d
        return workspace

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
