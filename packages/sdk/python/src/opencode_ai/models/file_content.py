from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.file_content_type import FileContentType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.file_content_patch import FileContentPatch


T = TypeVar("T", bound="FileContent")


@_attrs_define
class FileContent:
    """
    Attributes:
        type_ (FileContentType):
        content (str):
        diff (str | Unset):
        patch (FileContentPatch | Unset):
        encoding (Literal['base64'] | Unset):
        mime_type (str | Unset):
    """

    type_: FileContentType
    content: str
    diff: str | Unset = UNSET
    patch: FileContentPatch | Unset = UNSET
    encoding: Literal["base64"] | Unset = UNSET
    mime_type: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.file_content_patch import FileContentPatch

        type_ = self.type_.value

        content = self.content

        diff = self.diff

        patch: dict[str, Any] | Unset = UNSET
        if not isinstance(self.patch, Unset):
            patch = self.patch.to_dict()

        encoding = self.encoding

        mime_type = self.mime_type

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "content": content,
            }
        )
        if diff is not UNSET:
            field_dict["diff"] = diff
        if patch is not UNSET:
            field_dict["patch"] = patch
        if encoding is not UNSET:
            field_dict["encoding"] = encoding
        if mime_type is not UNSET:
            field_dict["mimeType"] = mime_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_content_patch import FileContentPatch

        d = dict(src_dict)
        type_ = FileContentType(d.pop("type"))

        content = d.pop("content")

        diff = d.pop("diff", UNSET)

        _patch = d.pop("patch", UNSET)
        patch: FileContentPatch | Unset
        if isinstance(_patch, Unset):
            patch = UNSET
        else:
            patch = FileContentPatch.from_dict(_patch)

        encoding = cast(Literal["base64"] | Unset, d.pop("encoding", UNSET))
        if encoding != "base64" and not isinstance(encoding, Unset):
            raise ValueError(f"encoding must match const 'base64', got '{encoding}'")

        mime_type = d.pop("mimeType", UNSET)

        file_content = cls(
            type_=type_,
            content=content,
            diff=diff,
            patch=patch,
            encoding=encoding,
            mime_type=mime_type,
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
