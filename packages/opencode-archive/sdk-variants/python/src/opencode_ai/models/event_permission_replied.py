from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.event_permission_replied_properties import EventPermissionRepliedProperties


T = TypeVar("T", bound="EventPermissionReplied")


@_attrs_define
class EventPermissionReplied:
    """
    Attributes:
        type_ (Literal['permission.replied']):
        properties (EventPermissionRepliedProperties):
    """

    type_: Literal["permission.replied"]
    properties: "EventPermissionRepliedProperties"
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
        from ..models.event_permission_replied_properties import EventPermissionRepliedProperties

        d = dict(src_dict)
        type_ = cast(Literal["permission.replied"], d.pop("type"))
        if type_ != "permission.replied":
            raise ValueError(f"type must match const 'permission.replied', got '{type_}'")

        properties = EventPermissionRepliedProperties.from_dict(d.pop("properties"))

        event_permission_replied = cls(
            type_=type_,
            properties=properties,
        )

        event_permission_replied.additional_properties = d
        return event_permission_replied

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
