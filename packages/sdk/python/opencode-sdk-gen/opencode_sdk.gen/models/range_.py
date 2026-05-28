from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

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

    start: RangeStart
    end: RangeEnd

    def to_dict(self) -> dict[str, Any]:
        start = self.start.to_dict()

        end = self.end.to_dict()

        field_dict: dict[str, Any] = {}

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

        return range_
