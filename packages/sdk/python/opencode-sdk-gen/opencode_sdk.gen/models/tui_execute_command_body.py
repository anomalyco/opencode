from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="TuiExecuteCommandBody")


@_attrs_define
class TuiExecuteCommandBody:
    """
    Attributes:
        command (str):
    """

    command: str

    def to_dict(self) -> dict[str, Any]:
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
        command = d.pop("command")

        tui_execute_command_body = cls(
            command=command,
        )

        return tui_execute_command_body
