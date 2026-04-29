from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        extra (AppLogBodyExtra | Unset): Additional metadata for the log entry
    """

    service: str
    level: AppLogBodyLevel
    message: str
    extra: AppLogBodyExtra | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.app_log_body_extra import AppLogBodyExtra

        service = self.service

        level = self.level.value

        message = self.message

        extra: dict[str, Any] | Unset = UNSET
        if not isinstance(self.extra, Unset):
            extra = self.extra.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        app_log_body.additional_properties = d
        return app_log_body

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
