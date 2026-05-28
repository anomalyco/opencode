from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_tui_command_execute_type import EventTuiCommandExecuteType

if TYPE_CHECKING:
    from ..models.event_tui_command_execute_properties import EventTuiCommandExecuteProperties


T = TypeVar("T", bound="EventTuiCommandExecute")


@_attrs_define
class EventTuiCommandExecute:
    """
    Attributes:
        id (str):
        type_ (EventTuiCommandExecuteType):
        properties (EventTuiCommandExecuteProperties):
    """

    id: str
    type_: EventTuiCommandExecuteType
    properties: EventTuiCommandExecuteProperties

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
        from ..models.event_tui_command_execute_properties import EventTuiCommandExecuteProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventTuiCommandExecuteType(d.pop("type"))

        properties = EventTuiCommandExecuteProperties.from_dict(d.pop("properties"))

        event_tui_command_execute = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_tui_command_execute
