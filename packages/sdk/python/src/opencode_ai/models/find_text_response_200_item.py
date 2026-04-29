from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.find_text_response_200_item_lines import FindTextResponse200ItemLines
    from ..models.find_text_response_200_item_path import FindTextResponse200ItemPath
    from ..models.find_text_response_200_item_submatches_item import FindTextResponse200ItemSubmatchesItem


T = TypeVar("T", bound="FindTextResponse200Item")


@_attrs_define
class FindTextResponse200Item:
    """
    Attributes:
        path (FindTextResponse200ItemPath):
        lines (FindTextResponse200ItemLines):
        line_number (int):
        absolute_offset (int):
        submatches (list[FindTextResponse200ItemSubmatchesItem]):
    """

    path: FindTextResponse200ItemPath
    lines: FindTextResponse200ItemLines
    line_number: int
    absolute_offset: int
    submatches: list[FindTextResponse200ItemSubmatchesItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.find_text_response_200_item_lines import FindTextResponse200ItemLines
        from ..models.find_text_response_200_item_path import FindTextResponse200ItemPath
        from ..models.find_text_response_200_item_submatches_item import FindTextResponse200ItemSubmatchesItem

        path = self.path.to_dict()

        lines = self.lines.to_dict()

        line_number = self.line_number

        absolute_offset = self.absolute_offset

        submatches = []
        for submatches_item_data in self.submatches:
            submatches_item = submatches_item_data.to_dict()
            submatches.append(submatches_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "path": path,
                "lines": lines,
                "line_number": line_number,
                "absolute_offset": absolute_offset,
                "submatches": submatches,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.find_text_response_200_item_lines import FindTextResponse200ItemLines
        from ..models.find_text_response_200_item_path import FindTextResponse200ItemPath
        from ..models.find_text_response_200_item_submatches_item import FindTextResponse200ItemSubmatchesItem

        d = dict(src_dict)
        path = FindTextResponse200ItemPath.from_dict(d.pop("path"))

        lines = FindTextResponse200ItemLines.from_dict(d.pop("lines"))

        line_number = d.pop("line_number")

        absolute_offset = d.pop("absolute_offset")

        submatches = []
        _submatches = d.pop("submatches")
        for submatches_item_data in _submatches:
            submatches_item = FindTextResponse200ItemSubmatchesItem.from_dict(submatches_item_data)

            submatches.append(submatches_item)

        find_text_response_200_item = cls(
            path=path,
            lines=lines,
            line_number=line_number,
            absolute_offset=absolute_offset,
            submatches=submatches,
        )

        find_text_response_200_item.additional_properties = d
        return find_text_response_200_item

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
