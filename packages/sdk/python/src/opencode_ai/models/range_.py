from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.range_end import RangeEnd
    from ..models.range_start import RangeStart


T = TypeVar("T", bound="Range")


@_attrs_define
class Range:
    """
    Attributes:
        start (RangeStart):
        end (RangeEnd):
    """

    start: "RangeStart"
    end: "RangeEnd"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        start = self.start.to_dict()

        end = self.end.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "start": start,
                "end": end,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.range_end import RangeEnd
        from ..models.range_start import RangeStart

        d = dict(src_dict)
        start = RangeStart.from_dict(d.pop("start"))

        end = RangeEnd.from_dict(d.pop("end"))

        range_ = cls(
            start=start,
            end=end,
        )

        range_.additional_properties = d
        return range_

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
