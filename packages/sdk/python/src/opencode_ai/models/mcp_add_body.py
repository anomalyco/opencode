from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.mcp_local_config import McpLocalConfig
    from ..models.mcp_remote_config import McpRemoteConfig


T = TypeVar("T", bound="McpAddBody")


@_attrs_define
class McpAddBody:
    """
    Attributes:
        name (str):
        config (McpLocalConfig | McpRemoteConfig):
    """

    name: str
    config: McpLocalConfig | McpRemoteConfig
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.mcp_local_config import McpLocalConfig
        from ..models.mcp_remote_config import McpRemoteConfig

        name = self.name

        config: dict[str, Any]
        if isinstance(self.config, McpLocalConfig):
            config = self.config.to_dict()
        else:
            config = self.config.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "config": config,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.mcp_local_config import McpLocalConfig
        from ..models.mcp_remote_config import McpRemoteConfig

        d = dict(src_dict)
        name = d.pop("name")

        def _parse_config(data: object) -> McpLocalConfig | McpRemoteConfig:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                config_type_0 = McpLocalConfig.from_dict(data)

                return config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            config_type_1 = McpRemoteConfig.from_dict(data)

            return config_type_1

        config = _parse_config(d.pop("config"))

        mcp_add_body = cls(
            name=name,
            config=config,
        )

        mcp_add_body.additional_properties = d
        return mcp_add_body

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
