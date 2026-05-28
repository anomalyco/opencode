from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.tui_show_toast_body_variant import TuiShowToastBodyVariant
from ..types import UNSET, Unset

T = TypeVar("T", bound="TuiShowToastBody")


@_attrs_define
class TuiShowToastBody:
    """
    Attributes:
        message (str):
        variant (TuiShowToastBodyVariant):
        title (str | Unset):
        duration (int | Unset):
    """

    message: str
    variant: TuiShowToastBodyVariant
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

        variant = TuiShowToastBodyVariant(d.pop("variant"))

        title = d.pop("title", UNSET)

        duration = d.pop("duration", UNSET)

        tui_show_toast_body = cls(
            message=message,
            variant=variant,
            title=title,
            duration=duration,
        )

        return tui_show_toast_body
