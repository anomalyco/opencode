from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="McpAuthStartResponse200")


@_attrs_define
class McpAuthStartResponse200:
    """OAuth flow started

    Attributes:
        authorization_url (str):
        oauth_state (str):
    """

    authorization_url: str
    oauth_state: str

    def to_dict(self) -> dict[str, Any]:
        authorization_url = self.authorization_url

        oauth_state = self.oauth_state

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "authorizationUrl": authorization_url,
                "oauthState": oauth_state,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        authorization_url = d.pop("authorizationUrl")

        oauth_state = d.pop("oauthState")

        mcp_auth_start_response_200 = cls(
            authorization_url=authorization_url,
            oauth_state=oauth_state,
        )

        return mcp_auth_start_response_200
