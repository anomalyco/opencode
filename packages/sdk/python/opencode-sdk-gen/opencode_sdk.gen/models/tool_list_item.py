from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ToolListItem")


@_attrs_define
class ToolListItem:
    """
    Attributes:
        id (str):
        description (str):
        parameters (Any):
    """

    id: str
    description: str
    parameters: Any

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        description = self.description

        parameters = self.parameters

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "description": description,
                "parameters": parameters,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        description = d.pop("description")

        parameters = d.pop("parameters")

        tool_list_item = cls(
            id=id,
            description=description,
            parameters=parameters,
        )

        return tool_list_item
