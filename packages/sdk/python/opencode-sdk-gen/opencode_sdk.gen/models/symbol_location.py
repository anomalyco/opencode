from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.range_ import Range


T = TypeVar("T", bound="SymbolLocation")


@_attrs_define
class SymbolLocation:
    """
    Attributes:
        uri (str):
        range_ (Range):
    """

    uri: str
    range_: Range

    def to_dict(self) -> dict[str, Any]:
        uri = self.uri

        range_ = self.range_.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "uri": uri,
                "range": range_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.range_ import Range

        d = dict(src_dict)
        uri = d.pop("uri")

        range_ = Range.from_dict(d.pop("range"))

        symbol_location = cls(
            uri=uri,
            range_=range_,
        )

        return symbol_location
