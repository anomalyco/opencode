from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.file_content_patch_hunks_item import FileContentPatchHunksItem


T = TypeVar("T", bound="FileContentPatch")


@_attrs_define
class FileContentPatch:
    """
    Attributes:
        old_file_name (str):
        new_file_name (str):
        hunks (list[FileContentPatchHunksItem]):
        old_header (str | Unset):
        new_header (str | Unset):
        index (str | Unset):
    """

    old_file_name: str
    new_file_name: str
    hunks: list[FileContentPatchHunksItem]
    old_header: str | Unset = UNSET
    new_header: str | Unset = UNSET
    index: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        old_file_name = self.old_file_name

        new_file_name = self.new_file_name

        hunks = []
        for hunks_item_data in self.hunks:
            hunks_item = hunks_item_data.to_dict()
            hunks.append(hunks_item)

        old_header = self.old_header

        new_header = self.new_header

        index = self.index

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "oldFileName": old_file_name,
                "newFileName": new_file_name,
                "hunks": hunks,
            }
        )
        if old_header is not UNSET:
            field_dict["oldHeader"] = old_header
        if new_header is not UNSET:
            field_dict["newHeader"] = new_header
        if index is not UNSET:
            field_dict["index"] = index

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_content_patch_hunks_item import FileContentPatchHunksItem

        d = dict(src_dict)
        old_file_name = d.pop("oldFileName")

        new_file_name = d.pop("newFileName")

        hunks = []
        _hunks = d.pop("hunks")
        for hunks_item_data in _hunks:
            hunks_item = FileContentPatchHunksItem.from_dict(hunks_item_data)

            hunks.append(hunks_item)

        old_header = d.pop("oldHeader", UNSET)

        new_header = d.pop("newHeader", UNSET)

        index = d.pop("index", UNSET)

        file_content_patch = cls(
            old_file_name=old_file_name,
            new_file_name=new_file_name,
            hunks=hunks,
            old_header=old_header,
            new_header=new_header,
            index=index,
        )

        return file_content_patch
