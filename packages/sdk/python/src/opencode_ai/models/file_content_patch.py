from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        hunks (list['FileContentPatchHunksItem']):
        old_header (Union[Unset, str]):
        new_header (Union[Unset, str]):
        index (Union[Unset, str]):
    """

    old_file_name: str
    new_file_name: str
    hunks: list["FileContentPatchHunksItem"]
    old_header: Union[Unset, str] = UNSET
    new_header: Union[Unset, str] = UNSET
    index: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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
        field_dict.update(self.additional_properties)
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

        file_content_patch.additional_properties = d
        return file_content_patch

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
