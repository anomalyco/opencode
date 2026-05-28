from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ImageAttachmentConfig")


@_attrs_define
class ImageAttachmentConfig:
    """
    Attributes:
        auto_resize (bool | Unset):
        max_width (int | Unset):
        max_height (int | Unset):
        max_base64_bytes (int | Unset):
    """

    auto_resize: bool | Unset = UNSET
    max_width: int | Unset = UNSET
    max_height: int | Unset = UNSET
    max_base64_bytes: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        auto_resize = self.auto_resize

        max_width = self.max_width

        max_height = self.max_height

        max_base64_bytes = self.max_base64_bytes

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if auto_resize is not UNSET:
            field_dict["auto_resize"] = auto_resize
        if max_width is not UNSET:
            field_dict["max_width"] = max_width
        if max_height is not UNSET:
            field_dict["max_height"] = max_height
        if max_base64_bytes is not UNSET:
            field_dict["max_base64_bytes"] = max_base64_bytes

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        auto_resize = d.pop("auto_resize", UNSET)

        max_width = d.pop("max_width", UNSET)

        max_height = d.pop("max_height", UNSET)

        max_base64_bytes = d.pop("max_base64_bytes", UNSET)

        image_attachment_config = cls(
            auto_resize=auto_resize,
            max_width=max_width,
            max_height=max_height,
            max_base64_bytes=max_base64_bytes,
        )

        return image_attachment_config
