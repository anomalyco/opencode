from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.event_ide_installed_properties import EventIdeInstalledProperties


T = TypeVar("T", bound="EventIdeInstalled")


@_attrs_define
class EventIdeInstalled:
    """
    Attributes:
        type_ (Literal['ide.installed']):
        properties (EventIdeInstalledProperties):
    """

    type_: Literal["ide.installed"]
    properties: "EventIdeInstalledProperties"
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
        from ..models.event_ide_installed_properties import EventIdeInstalledProperties

        d = dict(src_dict)
        type_ = cast(Literal["ide.installed"], d.pop("type"))
        if type_ != "ide.installed":
            raise ValueError(f"type must match const 'ide.installed', got '{type_}'")

        properties = EventIdeInstalledProperties.from_dict(d.pop("properties"))

        event_ide_installed = cls(
            type_=type_,
            properties=properties,
        )

        event_ide_installed.additional_properties = d
        return event_ide_installed

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
