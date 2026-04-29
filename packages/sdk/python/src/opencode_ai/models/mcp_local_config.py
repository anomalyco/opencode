from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.mcp_local_config_environment import McpLocalConfigEnvironment


T = TypeVar("T", bound="McpLocalConfig")


@_attrs_define
class McpLocalConfig:
    """
    Attributes:
        type_ (Literal['local']): Type of MCP server connection
        command (list[str]): Command and arguments to run the MCP server
        environment (McpLocalConfigEnvironment | Unset): Environment variables to set when running the MCP server
        enabled (bool | Unset): Enable or disable the MCP server on startup
        timeout (int | Unset): Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.
    """

    type_: Literal["local"]
    command: list[str]
    environment: McpLocalConfigEnvironment | Unset = UNSET
    enabled: bool | Unset = UNSET
    timeout: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.mcp_local_config_environment import McpLocalConfigEnvironment

        type_ = self.type_

        command = self.command

        environment: dict[str, Any] | Unset = UNSET
        if not isinstance(self.environment, Unset):
            environment = self.environment.to_dict()

        enabled = self.enabled

        timeout = self.timeout

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "command": command,
            }
        )
        if environment is not UNSET:
            field_dict["environment"] = environment
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if timeout is not UNSET:
            field_dict["timeout"] = timeout

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.mcp_local_config_environment import McpLocalConfigEnvironment

        d = dict(src_dict)
        type_ = cast(Literal["local"], d.pop("type"))
        if type_ != "local":
            raise ValueError(f"type must match const 'local', got '{type_}'")

        command = cast(list[str], d.pop("command"))

        _environment = d.pop("environment", UNSET)
        environment: McpLocalConfigEnvironment | Unset
        if isinstance(_environment, Unset):
            environment = UNSET
        else:
            environment = McpLocalConfigEnvironment.from_dict(_environment)

        enabled = d.pop("enabled", UNSET)

        timeout = d.pop("timeout", UNSET)

        mcp_local_config = cls(
            type_=type_,
            command=command,
            environment=environment,
            enabled=enabled,
            timeout=timeout,
        )

        mcp_local_config.additional_properties = d
        return mcp_local_config

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
