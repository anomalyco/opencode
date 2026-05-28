from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.tool_file_content_type import ToolFileContentType
from ..types import UNSET, Unset

T = TypeVar("T", bound="ToolFileContent")


@_attrs_define
class ToolFileContent:
    """
    Attributes:
        type_ (ToolFileContentType):
        uri (str):
        mime (str):
        name (str | Unset):
    """

    type_: ToolFileContentType
    uri: str
    mime: str
    name: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        uri = self.uri

        mime = self.mime

        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "uri": uri,
                "mime": mime,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = ToolFileContentType(d.pop("type"))

        uri = d.pop("uri")

        mime = d.pop("mime")

        name = d.pop("name", UNSET)

        tool_file_content = cls(
            type_=type_,
            uri=uri,
            mime=mime,
            name=name,
        )

        return tool_file_content
