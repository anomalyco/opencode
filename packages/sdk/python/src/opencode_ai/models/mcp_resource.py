from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        uri = self.uri

        client = self.client

        description = self.description

        mime_type = self.mime_type

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        mcp_resource.additional_properties = d
        return mcp_resource

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
