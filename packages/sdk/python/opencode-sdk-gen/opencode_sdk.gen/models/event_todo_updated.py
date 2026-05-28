from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_todo_updated_type import EventTodoUpdatedType

if TYPE_CHECKING:
    from ..models.event_todo_updated_properties import EventTodoUpdatedProperties


T = TypeVar("T", bound="EventTodoUpdated")


@_attrs_define
class EventTodoUpdated:
    """
    Attributes:
        id (str):
        type_ (EventTodoUpdatedType):
        properties (EventTodoUpdatedProperties):
    """

    id: str
    type_: EventTodoUpdatedType
    properties: EventTodoUpdatedProperties

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
        from ..models.event_todo_updated_properties import EventTodoUpdatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventTodoUpdatedType(d.pop("type"))

        properties = EventTodoUpdatedProperties.from_dict(d.pop("properties"))

        event_todo_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_todo_updated
