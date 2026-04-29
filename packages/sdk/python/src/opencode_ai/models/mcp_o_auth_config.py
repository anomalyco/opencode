from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="McpOAuthConfig")


@_attrs_define
class McpOAuthConfig:
    """
    Attributes:
        client_id (str | Unset): OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be
            attempted.
        client_secret (str | Unset): OAuth client secret (if required by the authorization server)
        scope (str | Unset): OAuth scopes to request during authorization
        redirect_uri (str | Unset): OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback).
    """

    client_id: str | Unset = UNSET
    client_secret: str | Unset = UNSET
    scope: str | Unset = UNSET
    redirect_uri: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        client_id = self.client_id

        client_secret = self.client_secret

        scope = self.scope

        redirect_uri = self.redirect_uri

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if client_id is not UNSET:
            field_dict["clientId"] = client_id
        if client_secret is not UNSET:
            field_dict["clientSecret"] = client_secret
        if scope is not UNSET:
            field_dict["scope"] = scope
        if redirect_uri is not UNSET:
            field_dict["redirectUri"] = redirect_uri

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        client_id = d.pop("clientId", UNSET)

        client_secret = d.pop("clientSecret", UNSET)

        scope = d.pop("scope", UNSET)

        redirect_uri = d.pop("redirectUri", UNSET)

        mcp_o_auth_config = cls(
            client_id=client_id,
            client_secret=client_secret,
            scope=scope,
            redirect_uri=redirect_uri,
        )

        mcp_o_auth_config.additional_properties = d
        return mcp_o_auth_config

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
