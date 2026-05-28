from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_session_next_compaction_started_type import EventSessionNextCompactionStartedType

if TYPE_CHECKING:
    from ..models.event_session_next_compaction_started_properties import EventSessionNextCompactionStartedProperties


T = TypeVar("T", bound="EventSessionNextCompactionStarted")


@_attrs_define
class EventSessionNextCompactionStarted:
    """
    Attributes:
        id (str):
        type_ (EventSessionNextCompactionStartedType):
        properties (EventSessionNextCompactionStartedProperties):
    """

    id: str
    type_: EventSessionNextCompactionStartedType
    properties: EventSessionNextCompactionStartedProperties

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
        from ..models.event_session_next_compaction_started_properties import (
            EventSessionNextCompactionStartedProperties,
        )

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventSessionNextCompactionStartedType(d.pop("type"))

        properties = EventSessionNextCompactionStartedProperties.from_dict(d.pop("properties"))

        event_session_next_compaction_started = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_session_next_compaction_started
