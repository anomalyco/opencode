from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.mcp_o_auth_config import McpOAuthConfig
    from ..models.mcp_remote_config_headers import McpRemoteConfigHeaders


T = TypeVar("T", bound="McpRemoteConfig")


@_attrs_define
class McpRemoteConfig:
    """
    Attributes:
        type_ (Literal['remote']): Type of MCP server connection
        url (str): URL of the remote MCP server
        enabled (bool | Unset): Enable or disable the MCP server on startup
        headers (McpRemoteConfigHeaders | Unset): Headers to send with the request
        oauth (bool | McpOAuthConfig | Unset): OAuth authentication configuration for the MCP server. Set to false to
            disable OAuth auto-detection.
        timeout (int | Unset): Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.
    """

    type_: Literal["remote"]
    url: str
    enabled: bool | Unset = UNSET
    headers: McpRemoteConfigHeaders | Unset = UNSET
    oauth: bool | McpOAuthConfig | Unset = UNSET
    timeout: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.mcp_o_auth_config import McpOAuthConfig
        from ..models.mcp_remote_config_headers import McpRemoteConfigHeaders

        type_ = self.type_

        url = self.url

        enabled = self.enabled

        headers: dict[str, Any] | Unset = UNSET
        if not isinstance(self.headers, Unset):
            headers = self.headers.to_dict()

        oauth: bool | dict[str, Any] | Unset
        if isinstance(self.oauth, Unset):
            oauth = UNSET
        elif isinstance(self.oauth, McpOAuthConfig):
            oauth = self.oauth.to_dict()
        else:
            oauth = self.oauth

        timeout = self.timeout

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        if oauth is not UNSET:
            field_dict["oauth"] = oauth
        if timeout is not UNSET:
            field_dict["timeout"] = timeout

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.mcp_o_auth_config import McpOAuthConfig
        from ..models.mcp_remote_config_headers import McpRemoteConfigHeaders

        d = dict(src_dict)
        type_ = cast(Literal["remote"], d.pop("type"))
        if type_ != "remote":
            raise ValueError(f"type must match const 'remote', got '{type_}'")

        url = d.pop("url")

        enabled = d.pop("enabled", UNSET)

        _headers = d.pop("headers", UNSET)
        headers: McpRemoteConfigHeaders | Unset
        if isinstance(_headers, Unset):
            headers = UNSET
        else:
            headers = McpRemoteConfigHeaders.from_dict(_headers)

        def _parse_oauth(data: object) -> bool | McpOAuthConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                oauth_type_0 = McpOAuthConfig.from_dict(data)

                return oauth_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(bool | McpOAuthConfig | Unset, data)

        oauth = _parse_oauth(d.pop("oauth", UNSET))

        timeout = d.pop("timeout", UNSET)

        mcp_remote_config = cls(
            type_=type_,
            url=url,
            enabled=enabled,
            headers=headers,
            oauth=oauth,
            timeout=timeout,
        )

        mcp_remote_config.additional_properties = d
        return mcp_remote_config

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
