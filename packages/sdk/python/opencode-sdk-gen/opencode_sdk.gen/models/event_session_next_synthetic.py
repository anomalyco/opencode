from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_session_next_synthetic_type import EventSessionNextSyntheticType

if TYPE_CHECKING:
    from ..models.event_session_next_synthetic_properties import EventSessionNextSyntheticProperties


T = TypeVar("T", bound="EventSessionNextSynthetic")


@_attrs_define
class EventSessionNextSynthetic:
    """
    Attributes:
        id (str):
        type_ (EventSessionNextSyntheticType):
        properties (EventSessionNextSyntheticProperties):
    """

    id: str
    type_: EventSessionNextSyntheticType
    properties: EventSessionNextSyntheticProperties

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
        from ..models.event_session_next_synthetic_properties import EventSessionNextSyntheticProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventSessionNextSyntheticType(d.pop("type"))

        properties = EventSessionNextSyntheticProperties.from_dict(d.pop("properties"))

        event_session_next_synthetic = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_session_next_synthetic
