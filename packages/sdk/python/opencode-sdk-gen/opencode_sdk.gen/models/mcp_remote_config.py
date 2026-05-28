from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.mcp_remote_config_type import McpRemoteConfigType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.mcp_o_auth_config import McpOAuthConfig
    from ..models.mcp_remote_config_headers import McpRemoteConfigHeaders


T = TypeVar("T", bound="McpRemoteConfig")


@_attrs_define
class McpRemoteConfig:
    """
    Attributes:
        type_ (McpRemoteConfigType): Type of MCP server connection
        url (str): URL of the remote MCP server
        enabled (bool | Unset):
        headers (McpRemoteConfigHeaders | Unset):
        oauth (bool | McpOAuthConfig | Unset): OAuth authentication configuration for the MCP server. Set to false to
            disable OAuth auto-detection.
        timeout (int | Unset):
    """

    type_: McpRemoteConfigType
    url: str
    enabled: bool | Unset = UNSET
    headers: McpRemoteConfigHeaders | Unset = UNSET
    oauth: bool | McpOAuthConfig | Unset = UNSET
    timeout: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.mcp_o_auth_config import McpOAuthConfig

        type_ = self.type_.value

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
        type_ = McpRemoteConfigType(d.pop("type"))

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

        return mcp_remote_config
