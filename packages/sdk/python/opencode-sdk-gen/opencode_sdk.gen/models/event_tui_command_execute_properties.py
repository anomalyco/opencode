from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.event_tui_command_execute_properties_command_type_0 import EventTuiCommandExecutePropertiesCommandType0

T = TypeVar("T", bound="EventTuiCommandExecuteProperties")


@_attrs_define
class EventTuiCommandExecuteProperties:
    """
    Attributes:
        command (EventTuiCommandExecutePropertiesCommandType0 | str):
    """

    command: EventTuiCommandExecutePropertiesCommandType0 | str

    def to_dict(self) -> dict[str, Any]:
        command: str
        if isinstance(self.command, EventTuiCommandExecutePropertiesCommandType0):
            command = self.command.value
        else:
            command = self.command

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "command": command,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_command(data: object) -> EventTuiCommandExecutePropertiesCommandType0 | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                command_type_0 = EventTuiCommandExecutePropertiesCommandType0(data)

                return command_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(EventTuiCommandExecutePropertiesCommandType0 | str, data)

        command = _parse_command(d.pop("command"))

        event_tui_command_execute_properties = cls(
            command=command,
        )

        return event_tui_command_execute_properties
