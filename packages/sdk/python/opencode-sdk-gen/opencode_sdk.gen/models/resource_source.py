from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.resource_source_type import ResourceSourceType

if TYPE_CHECKING:
    from ..models.file_part_source_text import FilePartSourceText


T = TypeVar("T", bound="ResourceSource")


@_attrs_define
class ResourceSource:
    """
    Attributes:
        text (FilePartSourceText):
        type_ (ResourceSourceType):
        client_name (str):
        uri (str):
    """

    text: FilePartSourceText
    type_: ResourceSourceType
    client_name: str
    uri: str

    def to_dict(self) -> dict[str, Any]:
        text = self.text.to_dict()

        type_ = self.type_.value

        client_name = self.client_name

        uri = self.uri

        field_dict: dict[str, Any] = {}

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

        type_ = ResourceSourceType(d.pop("type"))

        client_name = d.pop("clientName")

        uri = d.pop("uri")

        resource_source = cls(
            text=text,
            type_=type_,
            client_name=client_name,
            uri=uri,
        )

        return resource_source
