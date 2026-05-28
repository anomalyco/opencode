from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="FindTextResponse200ItemSubmatchesItemMatch")


@_attrs_define
class FindTextResponse200ItemSubmatchesItemMatch:
    """
    Attributes:
        text (str):
    """

    text: str

    def to_dict(self) -> dict[str, Any]:
        text = self.text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "text": text,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        text = d.pop("text")

        find_text_response_200_item_submatches_item_match = cls(
            text=text,
        )

        return find_text_response_200_item_submatches_item_match
