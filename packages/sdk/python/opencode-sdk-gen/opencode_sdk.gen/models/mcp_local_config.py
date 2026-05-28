from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.mcp_local_config_type import McpLocalConfigType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.mcp_local_config_environment import McpLocalConfigEnvironment


T = TypeVar("T", bound="McpLocalConfig")


@_attrs_define
class McpLocalConfig:
    """
    Attributes:
        type_ (McpLocalConfigType): Type of MCP server connection
        command (list[str]): Command and arguments to run the MCP server
        environment (McpLocalConfigEnvironment | Unset):
        enabled (bool | Unset):
        timeout (int | Unset):
    """

    type_: McpLocalConfigType
    command: list[str]
    environment: McpLocalConfigEnvironment | Unset = UNSET
    enabled: bool | Unset = UNSET
    timeout: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        command = self.command

        environment: dict[str, Any] | Unset = UNSET
        if not isinstance(self.environment, Unset):
            environment = self.environment.to_dict()

        enabled = self.enabled

        timeout = self.timeout

        field_dict: dict[str, Any] = {}

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
        type_ = McpLocalConfigType(d.pop("type"))

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

        return mcp_local_config
