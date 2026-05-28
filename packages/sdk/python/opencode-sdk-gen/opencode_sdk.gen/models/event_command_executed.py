from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_command_executed_type import EventCommandExecutedType

if TYPE_CHECKING:
    from ..models.event_command_executed_properties import EventCommandExecutedProperties


T = TypeVar("T", bound="EventCommandExecuted")


@_attrs_define
class EventCommandExecuted:
    """
    Attributes:
        id (str):
        type_ (EventCommandExecutedType):
        properties (EventCommandExecutedProperties):
    """

    id: str
    type_: EventCommandExecutedType
    properties: EventCommandExecutedProperties

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
        from ..models.event_command_executed_properties import EventCommandExecutedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventCommandExecutedType(d.pop("type"))

        properties = EventCommandExecutedProperties.from_dict(d.pop("properties"))

        event_command_executed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_command_executed
