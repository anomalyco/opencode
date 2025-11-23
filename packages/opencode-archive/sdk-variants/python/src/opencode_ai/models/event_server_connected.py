from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.event_server_connected_properties import EventServerConnectedProperties


T = TypeVar("T", bound="EventServerConnected")


@_attrs_define
class EventServerConnected:
    """
    Attributes:
        type_ (Literal['server.connected']):
        properties (EventServerConnectedProperties):
    """

    type_: Literal["server.connected"]
    properties: "EventServerConnectedProperties"
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
        from ..models.event_server_connected_properties import EventServerConnectedProperties

        d = dict(src_dict)
        type_ = cast(Literal["server.connected"], d.pop("type"))
        if type_ != "server.connected":
            raise ValueError(f"type must match const 'server.connected', got '{type_}'")

        properties = EventServerConnectedProperties.from_dict(d.pop("properties"))

        event_server_connected = cls(
            type_=type_,
            properties=properties,
        )

        event_server_connected.additional_properties = d
        return event_server_connected

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
