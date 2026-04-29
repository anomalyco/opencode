from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.file_part_source_text import FilePartSourceText


T = TypeVar("T", bound="ResourceSource")


@_attrs_define
class ResourceSource:
    """
    Attributes:
        text (FilePartSourceText):
        type_ (Literal['resource']):
        client_name (str):
        uri (str):
    """

    text: FilePartSourceText
    type_: Literal["resource"]
    client_name: str
    uri: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.file_part_source_text import FilePartSourceText

        text = self.text.to_dict()

        type_ = self.type_

        client_name = self.client_name

        uri = self.uri

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "text": text,
                "type": type_,
                "clientName": client_name,
                "uri": uri,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_part_source_text import FilePartSourceText

        d = dict(src_dict)
        text = FilePartSourceText.from_dict(d.pop("text"))

        type_ = cast(Literal["resource"], d.pop("type"))
        if type_ != "resource":
            raise ValueError(f"type must match const 'resource', got '{type_}'")

        client_name = d.pop("clientName")

        uri = d.pop("uri")

        resource_source = cls(
            text=text,
            type_=type_,
            client_name=client_name,
            uri=uri,
        )

        resource_source.additional_properties = d
        return resource_source

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
