from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventCommandExecutedProperties")


@_attrs_define
class EventCommandExecutedProperties:
    """
    Attributes:
        name (str):
        session_id (str):
        arguments (str):
        message_id (str):
    """

    name: str
    session_id: str
    arguments: str
    message_id: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        session_id = self.session_id

        arguments = self.arguments

        message_id = self.message_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "sessionID": session_id,
                "arguments": arguments,
                "messageID": message_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        session_id = d.pop("sessionID")

        arguments = d.pop("arguments")

        message_id = d.pop("messageID")

        event_command_executed_properties = cls(
            name=name,
            session_id=session_id,
            arguments=arguments,
            message_id=message_id,
        )

        return event_command_executed_properties
