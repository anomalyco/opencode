from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        text = self.text

        audio = self.audio

        image = self.image

        video = self.video

        pdf = self.pdf

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        model_capabilities_input.additional_properties = d
        return model_capabilities_input

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
