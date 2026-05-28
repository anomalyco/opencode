from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_tui_toast_show_1_properties_variant import EventTuiToastShow1PropertiesVariant
from ..types import UNSET, Unset

T = TypeVar("T", bound="EventTuiToastShow1Properties")


@_attrs_define
class EventTuiToastShow1Properties:
    """
    Attributes:
        message (str):
        variant (EventTuiToastShow1PropertiesVariant):
        title (str | Unset):
        duration (int | Unset):
    """

    message: str
    variant: EventTuiToastShow1PropertiesVariant
    title: str | Unset = UNSET
    duration: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        variant = self.variant.value

        title = self.title

        duration = self.duration

        field_dict: dict[str, Any] = {}

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

        variant = EventTuiToastShow1PropertiesVariant(d.pop("variant"))

        title = d.pop("title", UNSET)

        duration = d.pop("duration", UNSET)

        event_tui_toast_show_1_properties = cls(
            message=message,
            variant=variant,
            title=title,
            duration=duration,
        )

        return event_tui_toast_show_1_properties
