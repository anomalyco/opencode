from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.mcp_server_not_found_error_tag import McpServerNotFoundErrorTag

T = TypeVar("T", bound="McpServerNotFoundError")


@_attrs_define
class McpServerNotFoundError:
    """
    Attributes:
        field_tag (McpServerNotFoundErrorTag):
        name (str):
        message (str):
    """

    field_tag: McpServerNotFoundErrorTag
    name: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        name = self.name

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "name": name,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = McpServerNotFoundErrorTag(d.pop("_tag"))

        name = d.pop("name")

        message = d.pop("message")

        mcp_server_not_found_error = cls(
            field_tag=field_tag,
            name=name,
            message=message,
        )

        return mcp_server_not_found_error
