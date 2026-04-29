from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.event_tui_toast_show_properties_variant import EventTuiToastShowPropertiesVariant
from ..types import UNSET, Unset

T = TypeVar("T", bound="EventTuiToastShowProperties")


@_attrs_define
class EventTuiToastShowProperties:
    """
    Attributes:
        message (str):
        variant (EventTuiToastShowPropertiesVariant):
        title (str | Unset):
        duration (int | Unset): Duration in milliseconds
    """

    message: str
    variant: EventTuiToastShowPropertiesVariant
    title: str | Unset = UNSET
    duration: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        variant = self.variant.value

        title = self.title

        duration = self.duration

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "message": message,
                "variant": variant,
            }
        )
        if title is not UNSET:
            field_dict["title"] = title
        if duration is not UNSET:
            field_dict["duration"] = duration

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        variant = EventTuiToastShowPropertiesVariant(d.pop("variant"))

        title = d.pop("title", UNSET)

        duration = d.pop("duration", UNSET)

        event_tui_toast_show_properties = cls(
            message=message,
            variant=variant,
            title=title,
            duration=duration,
        )

        event_tui_toast_show_properties.additional_properties = d
        return event_tui_toast_show_properties

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
