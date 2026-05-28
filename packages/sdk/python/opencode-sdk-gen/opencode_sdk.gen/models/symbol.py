from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.symbol_location import SymbolLocation


T = TypeVar("T", bound="Symbol")


@_attrs_define
class Symbol:
    """
    Attributes:
        name (str):
        kind (int):
        location (SymbolLocation):
    """

    name: str
    kind: int
    location: SymbolLocation

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        kind = self.kind

        location = self.location.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "kind": kind,
                "location": location,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.symbol_location import SymbolLocation

        d = dict(src_dict)
        name = d.pop("name")

        kind = d.pop("kind")

        location = SymbolLocation.from_dict(d.pop("location"))

        symbol = cls(
            name=name,
            kind=kind,
            location=location,
        )

        return symbol
