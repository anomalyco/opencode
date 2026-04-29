from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        session_id = self.session_id

        arguments = self.arguments

        message_id = self.message_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        event_command_executed_properties.additional_properties = d
        return event_command_executed_properties

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
