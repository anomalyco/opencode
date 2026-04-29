from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.event_tui_command_execute_properties_command_type_0 import EventTuiCommandExecutePropertiesCommandType0
from ..types import UNSET, Unset

T = TypeVar("T", bound="EventTuiCommandExecuteProperties")


@_attrs_define
class EventTuiCommandExecuteProperties:
    """
    Attributes:
        command (EventTuiCommandExecutePropertiesCommandType0 | str):
    """

    command: EventTuiCommandExecutePropertiesCommandType0 | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        command: str
        if isinstance(self.command, EventTuiCommandExecutePropertiesCommandType0):
            command = self.command.value
        else:
            command = self.command

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        event_tui_command_execute_properties.additional_properties = d
        return event_tui_command_execute_properties

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
