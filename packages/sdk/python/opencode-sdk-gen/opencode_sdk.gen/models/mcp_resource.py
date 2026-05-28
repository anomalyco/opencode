from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="McpResource")


@_attrs_define
class McpResource:
    """
    Attributes:
        name (str):
        uri (str):
        client (str):
        description (str | Unset):
        mime_type (str | Unset):
    """

    name: str
    uri: str
    client: str
    description: str | Unset = UNSET
    mime_type: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        uri = self.uri

        client = self.client

        description = self.description

        mime_type = self.mime_type

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "uri": uri,
                "client": client,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if mime_type is not UNSET:
            field_dict["mimeType"] = mime_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        uri = d.pop("uri")

        client = d.pop("client")

        description = d.pop("description", UNSET)

        mime_type = d.pop("mimeType", UNSET)

        mcp_resource = cls(
            name=name,
            uri=uri,
            client=client,
            description=description,
            mime_type=mime_type,
        )

        return mcp_resource
