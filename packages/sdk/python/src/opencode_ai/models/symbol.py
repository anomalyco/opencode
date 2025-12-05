from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.symbol_location import SymbolLocation


T = TypeVar("T", bound="Symbol")


@_attrs_define
class Symbol:
    """
    Attributes:
        name (str):
        kind (float):
        location (SymbolLocation):
    """

    name: str
    kind: float
    location: "SymbolLocation"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        kind = self.kind

        location = self.location.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        symbol.additional_properties = d
        return symbol

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
