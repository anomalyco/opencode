from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="McpOAuthConfig")


@_attrs_define
class McpOAuthConfig:
    """
    Attributes:
        client_id (str | Unset):
        client_secret (str | Unset):
        scope (str | Unset):
        callback_port (int | Unset):
        redirect_uri (str | Unset):
    """

    client_id: str | Unset = UNSET
    client_secret: str | Unset = UNSET
    scope: str | Unset = UNSET
    callback_port: int | Unset = UNSET
    redirect_uri: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        client_id = self.client_id

        client_secret = self.client_secret

        scope = self.scope

        callback_port = self.callback_port

        redirect_uri = self.redirect_uri

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if client_id is not UNSET:
            field_dict["clientId"] = client_id
        if client_secret is not UNSET:
            field_dict["clientSecret"] = client_secret
        if scope is not UNSET:
            field_dict["scope"] = scope
        if callback_port is not UNSET:
            field_dict["callbackPort"] = callback_port
        if redirect_uri is not UNSET:
            field_dict["redirectUri"] = redirect_uri

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        client_id = d.pop("clientId", UNSET)

        client_secret = d.pop("clientSecret", UNSET)

        scope = d.pop("scope", UNSET)

        callback_port = d.pop("callbackPort", UNSET)

        redirect_uri = d.pop("redirectUri", UNSET)

        mcp_o_auth_config = cls(
            client_id=client_id,
            client_secret=client_secret,
            scope=scope,
            callback_port=callback_port,
            redirect_uri=redirect_uri,
        )

        return mcp_o_auth_config
