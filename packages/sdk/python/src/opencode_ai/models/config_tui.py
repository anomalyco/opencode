from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigTui")


@_attrs_define
class ConfigTui:
    """TUI specific settings

    Attributes:
        scroll_speed (Union[Unset, float]): TUI scroll speed Default: 2.0.
    """

    scroll_speed: Union[Unset, float] = 2.0
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scroll_speed = self.scroll_speed

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if scroll_speed is not UNSET:
            field_dict["scroll_speed"] = scroll_speed

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scroll_speed = d.pop("scroll_speed", UNSET)

        config_tui = cls(
            scroll_speed=scroll_speed,
        )

        config_tui.additional_properties = d
        return config_tui

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
