from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.image_attachment_config import ImageAttachmentConfig


T = TypeVar("T", bound="AttachmentConfig")


@_attrs_define
class AttachmentConfig:
    """
    Attributes:
        image (ImageAttachmentConfig | Unset):
    """

    image: ImageAttachmentConfig | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        image: dict[str, Any] | Unset = UNSET
        if not isinstance(self.image, Unset):
            image = self.image.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if image is not UNSET:
            field_dict["image"] = image

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.image_attachment_config import ImageAttachmentConfig

        d = dict(src_dict)
        _image = d.pop("image", UNSET)
        image: ImageAttachmentConfig | Unset
        if isinstance(_image, Unset):
            image = UNSET
        else:
            image = ImageAttachmentConfig.from_dict(_image)

        attachment_config = cls(
            image=image,
        )

        return attachment_config
