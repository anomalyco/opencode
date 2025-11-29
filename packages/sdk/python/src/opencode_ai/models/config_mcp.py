from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.mcp_local_config import McpLocalConfig
    from ..models.mcp_remote_config import McpRemoteConfig


T = TypeVar("T", bound="ConfigMcp")


@_attrs_define
class ConfigMcp:
    """MCP (Model Context Protocol) server configurations"""

    additional_properties: dict[str, Union["McpLocalConfig", "McpRemoteConfig"]] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.mcp_local_config import McpLocalConfig

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, McpLocalConfig):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.mcp_local_config import McpLocalConfig
        from ..models.mcp_remote_config import McpRemoteConfig

        d = dict(src_dict)
        config_mcp = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(data: object) -> Union["McpLocalConfig", "McpRemoteConfig"]:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_0 = McpLocalConfig.from_dict(data)

                    return additional_property_type_0
                except:  # noqa: E722
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_1 = McpRemoteConfig.from_dict(data)

                return additional_property_type_1

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        config_mcp.additional_properties = additional_properties
        return config_mcp

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Union["McpLocalConfig", "McpRemoteConfig"]:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Union["McpLocalConfig", "McpRemoteConfig"]) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
