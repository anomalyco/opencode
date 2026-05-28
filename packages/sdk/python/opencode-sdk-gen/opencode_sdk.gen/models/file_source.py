from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.file_source_type import FileSourceType

if TYPE_CHECKING:
    from ..models.file_part_source_text import FilePartSourceText


T = TypeVar("T", bound="FileSource")


@_attrs_define
class FileSource:
    """
    Attributes:
        text (FilePartSourceText):
        type_ (FileSourceType):
        path (str):
    """

    text: FilePartSourceText
    type_: FileSourceType
    path: str

    def to_dict(self) -> dict[str, Any]:
        text = self.text.to_dict()

        type_ = self.type_.value

        path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "text": text,
                "type": type_,
                "path": path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_part_source_text import FilePartSourceText

        d = dict(src_dict)
        text = FilePartSourceText.from_dict(d.pop("text"))

        type_ = FileSourceType(d.pop("type"))

        path = d.pop("path")

        file_source = cls(
            text=text,
            type_=type_,
            path=path,
        )

        return file_source
