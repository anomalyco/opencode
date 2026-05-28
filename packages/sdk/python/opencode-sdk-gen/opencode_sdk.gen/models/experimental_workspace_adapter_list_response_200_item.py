from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ExperimentalWorkspaceAdapterListResponse200Item")


@_attrs_define
class ExperimentalWorkspaceAdapterListResponse200Item:
    """
    Attributes:
        type_ (str):
        name (str):
        description (str):
    """

    type_: str
    name: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        name = self.name

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "name": name,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        name = d.pop("name")

        description = d.pop("description")

        experimental_workspace_adapter_list_response_200_item = cls(
            type_=type_,
            name=name,
            description=description,
        )

        return experimental_workspace_adapter_list_response_200_item
