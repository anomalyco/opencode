from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.file_part_source_text import FilePartSourceText
    from ..models.range_ import Range


T = TypeVar("T", bound="SymbolSource")


@_attrs_define
class SymbolSource:
    """
    Attributes:
        text (FilePartSourceText):
        type_ (Literal['symbol']):
        path (str):
        range_ (Range):
        name (str):
        kind (int):
    """

    text: "FilePartSourceText"
    type_: Literal["symbol"]
    path: str
    range_: "Range"
    name: str
    kind: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        text = self.text.to_dict()

        type_ = self.type_

        path = self.path

        range_ = self.range_.to_dict()

        name = self.name

        kind = self.kind

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        type_ = cast(Literal["symbol"], d.pop("type"))
        if type_ != "symbol":
            raise ValueError(f"type must match const 'symbol', got '{type_}'")

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

        symbol_source.additional_properties = d
        return symbol_source

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
