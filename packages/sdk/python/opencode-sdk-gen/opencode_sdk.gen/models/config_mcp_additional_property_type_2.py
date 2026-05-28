from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ConfigMcpAdditionalPropertyType2")


@_attrs_define
class ConfigMcpAdditionalPropertyType2:
    """
    Attributes:
        enabled (bool):
    """

    enabled: bool

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "enabled": enabled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        enabled = d.pop("enabled")

        config_mcp_additional_property_type_2 = cls(
            enabled=enabled,
        )

        return config_mcp_additional_property_type_2
