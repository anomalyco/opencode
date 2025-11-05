from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.event_message_part_updated_properties import EventMessagePartUpdatedProperties


T = TypeVar("T", bound="EventMessagePartUpdated")


@_attrs_define
class EventMessagePartUpdated:
    """
    Attributes:
        type_ (Literal['message.part.updated']):
        properties (EventMessagePartUpdatedProperties):
    """

    type_: Literal["message.part.updated"]
    properties: "EventMessagePartUpdatedProperties"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
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
        from ..models.event_message_part_updated_properties import EventMessagePartUpdatedProperties

        d = dict(src_dict)
        type_ = cast(Literal["message.part.updated"], d.pop("type"))
        if type_ != "message.part.updated":
            raise ValueError(f"type must match const 'message.part.updated', got '{type_}'")

        properties = EventMessagePartUpdatedProperties.from_dict(d.pop("properties"))

        event_message_part_updated = cls(
            type_=type_,
            properties=properties,
        )

        event_message_part_updated.additional_properties = d
        return event_message_part_updated

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
