from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="V2ModelListLocation")


@_attrs_define
class V2ModelListLocation:
    """
    Attributes:
        directory (str | Unset):
        workspace (str | Unset):
    """

    directory: str | Unset = UNSET
    workspace: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        directory = self.directory

        workspace = self.workspace

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if directory is not UNSET:
            field_dict["directory"] = directory
        if workspace is not UNSET:
            field_dict["workspace"] = workspace

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        directory = d.pop("directory", UNSET)

        workspace = d.pop("workspace", UNSET)

        v2_model_list_location = cls(
            directory=directory,
            workspace=workspace,
        )

        return v2_model_list_location
