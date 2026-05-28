from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_tui_toast_show_type import EventTuiToastShowType

if TYPE_CHECKING:
    from ..models.event_tui_toast_show_properties import EventTuiToastShowProperties


T = TypeVar("T", bound="EventTuiToastShow")


@_attrs_define
class EventTuiToastShow:
    """
    Attributes:
        id (str):
        type_ (EventTuiToastShowType):
        properties (EventTuiToastShowProperties):
    """

    id: str
    type_: EventTuiToastShowType
    properties: EventTuiToastShowProperties

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_.value

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_tui_toast_show_properties import EventTuiToastShowProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventTuiToastShowType(d.pop("type"))

        properties = EventTuiToastShowProperties.from_dict(d.pop("properties"))

        event_tui_toast_show = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_tui_toast_show
