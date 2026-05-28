from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.pty import Pty


T = TypeVar("T", bound="EventPtyCreatedProperties")


@_attrs_define
class EventPtyCreatedProperties:
    """
    Attributes:
        info (Pty):
    """

    info: Pty

    def to_dict(self) -> dict[str, Any]:
        info = self.info.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "info": info,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.pty import Pty

        d = dict(src_dict)
        info = Pty.from_dict(d.pop("info"))

        event_pty_created_properties = cls(
            info=info,
        )

        return event_pty_created_properties
