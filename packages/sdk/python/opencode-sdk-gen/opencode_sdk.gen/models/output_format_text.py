from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.output_format_text_type import OutputFormatTextType

T = TypeVar("T", bound="OutputFormatText")


@_attrs_define
class OutputFormatText:
    """
    Attributes:
        type_ (OutputFormatTextType):
    """

    type_: OutputFormatTextType

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = OutputFormatTextType(d.pop("type"))

        output_format_text = cls(
            type_=type_,
        )

        return output_format_text
