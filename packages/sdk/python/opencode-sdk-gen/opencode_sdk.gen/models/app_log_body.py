from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.app_log_body_level import AppLogBodyLevel
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.app_log_body_extra import AppLogBodyExtra


T = TypeVar("T", bound="AppLogBody")


@_attrs_define
class AppLogBody:
    """
    Attributes:
        service (str): Service name for the log entry
        level (AppLogBodyLevel): Log level
        message (str): Log message
        extra (AppLogBodyExtra | Unset):
    """

    service: str
    level: AppLogBodyLevel
    message: str
    extra: AppLogBodyExtra | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        service = self.service

        level = self.level.value

        message = self.message

        extra: dict[str, Any] | Unset = UNSET
        if not isinstance(self.extra, Unset):
            extra = self.extra.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "service": service,
                "level": level,
                "message": message,
            }
        )
        if extra is not UNSET:
            field_dict["extra"] = extra

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.app_log_body_extra import AppLogBodyExtra

        d = dict(src_dict)
        service = d.pop("service")

        level = AppLogBodyLevel(d.pop("level"))

        message = d.pop("message")

        _extra = d.pop("extra", UNSET)
        extra: AppLogBodyExtra | Unset
        if isinstance(_extra, Unset):
            extra = UNSET
        else:
            extra = AppLogBodyExtra.from_dict(_extra)

        app_log_body = cls(
            service=service,
            level=level,
            message=message,
            extra=extra,
        )

        return app_log_body
