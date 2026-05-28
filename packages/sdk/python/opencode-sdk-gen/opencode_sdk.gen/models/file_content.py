from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.file_content_encoding import FileContentEncoding
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
        encoding (FileContentEncoding | Unset):
        mime_type (str | Unset):
    """

    type_: FileContentType
    content: str
    diff: str | Unset = UNSET
    patch: FileContentPatch | Unset = UNSET
    encoding: FileContentEncoding | Unset = UNSET
    mime_type: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        content = self.content

        diff = self.diff

        patch: dict[str, Any] | Unset = UNSET
        if not isinstance(self.patch, Unset):
            patch = self.patch.to_dict()

        encoding: str | Unset = UNSET
        if not isinstance(self.encoding, Unset):
            encoding = self.encoding.value

        mime_type = self.mime_type

        field_dict: dict[str, Any] = {}

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

        _encoding = d.pop("encoding", UNSET)
        encoding: FileContentEncoding | Unset
        if isinstance(_encoding, Unset):
            encoding = UNSET
        else:
            encoding = FileContentEncoding(_encoding)

        mime_type = d.pop("mimeType", UNSET)

        file_content = cls(
            type_=type_,
            content=content,
            diff=diff,
            patch=patch,
            encoding=encoding,
            mime_type=mime_type,
        )

        return file_content
