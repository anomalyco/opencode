from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.symbol_source_type import SymbolSourceType

if TYPE_CHECKING:
    from ..models.file_part_source_text import FilePartSourceText
    from ..models.range_ import Range


T = TypeVar("T", bound="SymbolSource")


@_attrs_define
class SymbolSource:
    """
    Attributes:
        text (FilePartSourceText):
        type_ (SymbolSourceType):
        path (str):
        range_ (Range):
        name (str):
        kind (int):
    """

    text: FilePartSourceText
    type_: SymbolSourceType
    path: str
    range_: Range
    name: str
    kind: int

    def to_dict(self) -> dict[str, Any]:
        text = self.text.to_dict()

        type_ = self.type_.value

        path = self.path

        range_ = self.range_.to_dict()

        name = self.name

        kind = self.kind

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "text": text,
                "type": type_,
                "path": path,
                "range": range_,
                "name": name,
                "kind": kind,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_part_source_text import FilePartSourceText
        from ..models.range_ import Range

        d = dict(src_dict)
        text = FilePartSourceText.from_dict(d.pop("text"))

        type_ = SymbolSourceType(d.pop("type"))

        path = d.pop("path")

        range_ = Range.from_dict(d.pop("range"))

        name = d.pop("name")

        kind = d.pop("kind")

        symbol_source = cls(
            text=text,
            type_=type_,
            path=path,
            range_=range_,
            name=name,
            kind=kind,
        )

        return symbol_source
