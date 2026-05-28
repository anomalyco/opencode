from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.tool_text_content_type import ToolTextContentType

T = TypeVar("T", bound="ToolTextContent")


@_attrs_define
class ToolTextContent:
    """
    Attributes:
        type_ (ToolTextContentType):
        text (str):
    """

    type_: ToolTextContentType
    text: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        text = self.text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "text": text,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = ToolTextContentType(d.pop("type"))

        text = d.pop("text")

        tool_text_content = cls(
            type_=type_,
            text=text,
        )

        return tool_text_content
