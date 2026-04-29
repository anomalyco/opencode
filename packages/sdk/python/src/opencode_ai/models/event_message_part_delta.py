from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_message_part_delta_properties import EventMessagePartDeltaProperties


T = TypeVar("T", bound="EventMessagePartDelta")


@_attrs_define
class EventMessagePartDelta:
    """
    Attributes:
        type_ (Literal['message.part.delta']):
        properties (EventMessagePartDeltaProperties):
    """

    type_: Literal["message.part.delta"]
    properties: EventMessagePartDeltaProperties
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.event_message_part_delta_properties import EventMessagePartDeltaProperties

        type_ = self.type_

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_message_part_delta_properties import EventMessagePartDeltaProperties

        d = dict(src_dict)
        type_ = cast(Literal["message.part.delta"], d.pop("type"))
        if type_ != "message.part.delta":
            raise ValueError(f"type must match const 'message.part.delta', got '{type_}'")

        properties = EventMessagePartDeltaProperties.from_dict(d.pop("properties"))

        event_message_part_delta = cls(
            type_=type_,
            properties=properties,
        )

        event_message_part_delta.additional_properties = d
        return event_message_part_delta

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
