from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.event_session_updated_properties import EventSessionUpdatedProperties


T = TypeVar("T", bound="EventSessionUpdated")


@_attrs_define
class EventSessionUpdated:
    """
    Attributes:
        type_ (Literal['session.updated']):
        properties (EventSessionUpdatedProperties):
    """

    type_: Literal["session.updated"]
    properties: "EventSessionUpdatedProperties"
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
        from ..models.event_session_updated_properties import EventSessionUpdatedProperties

        d = dict(src_dict)
        type_ = cast(Literal["session.updated"], d.pop("type"))
        if type_ != "session.updated":
            raise ValueError(f"type must match const 'session.updated', got '{type_}'")

        properties = EventSessionUpdatedProperties.from_dict(d.pop("properties"))

        event_session_updated = cls(
            type_=type_,
            properties=properties,
        )

        event_session_updated.additional_properties = d
        return event_session_updated

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
