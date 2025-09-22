from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.mcp_remote_config_headers import McpRemoteConfigHeaders


T = TypeVar("T", bound="McpRemoteConfig")


@_attrs_define
class McpRemoteConfig:
    """
    Attributes:
        type_ (Literal['remote']): Type of MCP server connection
        url (str): URL of the remote MCP server
        enabled (Union[Unset, bool]): Enable or disable the MCP server on startup
        headers (Union[Unset, McpRemoteConfigHeaders]): Headers to send with the request
    """

    type_: Literal["remote"]
    url: str
    enabled: Union[Unset, bool] = UNSET
    headers: Union[Unset, "McpRemoteConfigHeaders"] = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        url = self.url

        enabled = self.enabled

        headers: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.headers, Unset):
            headers = self.headers.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "url": url,
            }
        )
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if headers is not UNSET:
            field_dict["headers"] = headers

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.mcp_remote_config_headers import McpRemoteConfigHeaders

        d = dict(src_dict)
        type_ = cast(Literal["remote"], d.pop("type"))
        if type_ != "remote":
            raise ValueError(f"type must match const 'remote', got '{type_}'")

        url = d.pop("url")

        enabled = d.pop("enabled", UNSET)

        _headers = d.pop("headers", UNSET)
        headers: Union[Unset, McpRemoteConfigHeaders]
        if isinstance(_headers, Unset):
            headers = UNSET
        else:
            headers = McpRemoteConfigHeaders.from_dict(_headers)

        mcp_remote_config = cls(
            type_=type_,
            url=url,
            enabled=enabled,
            headers=headers,
        )

        return mcp_remote_config
