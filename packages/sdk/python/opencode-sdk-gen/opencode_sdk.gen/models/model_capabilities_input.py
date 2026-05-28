from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ModelCapabilitiesInput")


@_attrs_define
class ModelCapabilitiesInput:
    """
    Attributes:
        text (bool):
        audio (bool):
        image (bool):
        video (bool):
        pdf (bool):
    """

    text: bool
    audio: bool
    image: bool
    video: bool
    pdf: bool

    def to_dict(self) -> dict[str, Any]:
        text = self.text

        audio = self.audio

        image = self.image

        video = self.video

        pdf = self.pdf

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "text": text,
                "audio": audio,
                "image": image,
                "video": video,
                "pdf": pdf,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        text = d.pop("text")

        audio = d.pop("audio")

        image = d.pop("image")

        video = d.pop("video")

        pdf = d.pop("pdf")

        model_capabilities_input = cls(
            text=text,
            audio=audio,
            image=image,
            video=video,
            pdf=pdf,
        )

        return model_capabilities_input
