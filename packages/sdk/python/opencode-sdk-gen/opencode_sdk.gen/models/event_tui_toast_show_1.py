from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_tui_toast_show_1_type import EventTuiToastShow1Type

if TYPE_CHECKING:
    from ..models.event_tui_toast_show_1_properties import EventTuiToastShow1Properties


T = TypeVar("T", bound="EventTuiToastShow1")


@_attrs_define
class EventTuiToastShow1:
    """
    Attributes:
        id (str):
        type_ (EventTuiToastShow1Type):
        properties (EventTuiToastShow1Properties):
    """

    id: str
    type_: EventTuiToastShow1Type
    properties: EventTuiToastShow1Properties

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
        from ..models.event_tui_toast_show_1_properties import EventTuiToastShow1Properties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventTuiToastShow1Type(d.pop("type"))

        properties = EventTuiToastShow1Properties.from_dict(d.pop("properties"))

        event_tui_toast_show_1 = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_tui_toast_show_1
