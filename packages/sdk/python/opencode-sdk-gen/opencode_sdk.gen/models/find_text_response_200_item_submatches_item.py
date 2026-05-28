from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.find_text_response_200_item_submatches_item_match import FindTextResponse200ItemSubmatchesItemMatch


T = TypeVar("T", bound="FindTextResponse200ItemSubmatchesItem")


@_attrs_define
class FindTextResponse200ItemSubmatchesItem:
    """
    Attributes:
        match (FindTextResponse200ItemSubmatchesItemMatch):
        start (int):
        end (int):
    """

    match: FindTextResponse200ItemSubmatchesItemMatch
    start: int
    end: int

    def to_dict(self) -> dict[str, Any]:
        match = self.match.to_dict()

        start = self.start

        end = self.end

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "match": match,
                "start": start,
                "end": end,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.find_text_response_200_item_submatches_item_match import (
            FindTextResponse200ItemSubmatchesItemMatch,
        )

        d = dict(src_dict)
        match = FindTextResponse200ItemSubmatchesItemMatch.from_dict(d.pop("match"))

        start = d.pop("start")

        end = d.pop("end")

        find_text_response_200_item_submatches_item = cls(
            match=match,
            start=start,
            end=end,
        )

        return find_text_response_200_item_submatches_item
