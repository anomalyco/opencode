from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    range_: "Range"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        uri = self.uri

        range_ = self.range_.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        symbol_location.additional_properties = d
        return symbol_location

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
