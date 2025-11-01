from collections.abc import Mapping
from enum import Enum
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigTui")


class ConfigTuiSidebar(str, Enum):
    AUTO = "auto"
    SHOW = "show"
    HIDE = "hide"

    def __str__(self) -> str:
        return str(self.value)


@_attrs_define
class ConfigTui:
    """TUI specific settings

    Attributes:
        scroll_speed (Union[Unset, float]): TUI scroll speed Default: 2.0.
        sidebar (Union[Unset, ConfigTuiSidebar]): Default sidebar visibility state Default: ConfigTuiSidebar.AUTO.
    """

    scroll_speed: Union[Unset, float] = 2.0
    sidebar: Union[Unset, ConfigTuiSidebar] = ConfigTuiSidebar.AUTO
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scroll_speed = self.scroll_speed
        sidebar: Union[Unset, str] = UNSET
        if not isinstance(self.sidebar, Unset):
            sidebar = self.sidebar.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if scroll_speed is not UNSET:
            field_dict["scroll_speed"] = scroll_speed
        if sidebar is not UNSET:
            field_dict["sidebar"] = sidebar

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scroll_speed = d.pop("scroll_speed", UNSET)
        _sidebar = d.pop("sidebar", UNSET)

        sidebar: Union[Unset, ConfigTuiSidebar]
        if isinstance(_sidebar, Unset):
            sidebar = UNSET
        else:
            sidebar = ConfigTuiSidebar(_sidebar)

        config_tui = cls(
            scroll_speed=scroll_speed,
            sidebar=sidebar,
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
