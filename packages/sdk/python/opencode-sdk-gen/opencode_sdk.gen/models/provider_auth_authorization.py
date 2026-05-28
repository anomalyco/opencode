from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_auth_authorization_method import ProviderAuthAuthorizationMethod

T = TypeVar("T", bound="ProviderAuthAuthorization")


@_attrs_define
class ProviderAuthAuthorization:
    """
    Attributes:
        url (str):
        method (ProviderAuthAuthorizationMethod):
        instructions (str):
    """

    url: str
    method: ProviderAuthAuthorizationMethod
    instructions: str

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        method = self.method.value

        instructions = self.instructions

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "url": url,
                "method": method,
                "instructions": instructions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        method = ProviderAuthAuthorizationMethod(d.pop("method"))

        instructions = d.pop("instructions")

        provider_auth_authorization = cls(
            url=url,
            method=method,
            instructions=instructions,
        )

        return provider_auth_authorization
