from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define

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
        environment (Union[Unset, McpLocalConfigEnvironment]): Environment variables to set when running the MCP server
        enabled (Union[Unset, bool]): Enable or disable the MCP server on startup
    """

    type_: Literal["local"]
    command: list[str]
    environment: Union[Unset, "McpLocalConfigEnvironment"] = UNSET
    enabled: Union[Unset, bool] = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        command = self.command

        environment: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.environment, Unset):
            environment = self.environment.to_dict()

        enabled = self.enabled

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
        environment: Union[Unset, McpLocalConfigEnvironment]
        if isinstance(_environment, Unset):
            environment = UNSET
        else:
            environment = McpLocalConfigEnvironment.from_dict(_environment)

        enabled = d.pop("enabled", UNSET)

        mcp_local_config = cls(
            type_=type_,
            command=command,
            environment=environment,
            enabled=enabled,
        )

        return mcp_local_config
