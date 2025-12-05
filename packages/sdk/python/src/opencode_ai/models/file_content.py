from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.file_content_patch import FileContentPatch


T = TypeVar("T", bound="FileContent")


@_attrs_define
class FileContent:
    """
    Attributes:
        content (str):
        diff (Union[Unset, str]):
        patch (Union[Unset, FileContentPatch]):
    """

    content: str
    diff: Union[Unset, str] = UNSET
    patch: Union[Unset, "FileContentPatch"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        content = self.content

        diff = self.diff

        patch: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.patch, Unset):
            patch = self.patch.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "content": content,
            }
        )
        if diff is not UNSET:
            field_dict["diff"] = diff
        if patch is not UNSET:
            field_dict["patch"] = patch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_content_patch import FileContentPatch

        d = dict(src_dict)
        content = d.pop("content")

        diff = d.pop("diff", UNSET)

        _patch = d.pop("patch", UNSET)
        patch: Union[Unset, FileContentPatch]
        if isinstance(_patch, Unset):
            patch = UNSET
        else:
            patch = FileContentPatch.from_dict(_patch)

        file_content = cls(
            content=content,
            diff=diff,
            patch=patch,
        )

        file_content.additional_properties = d
        return file_content

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
