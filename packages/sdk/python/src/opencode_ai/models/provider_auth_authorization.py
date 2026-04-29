from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.provider_auth_authorization_method import ProviderAuthAuthorizationMethod
from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        method = self.method.value

        instructions = self.instructions

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        provider_auth_authorization.additional_properties = d
        return provider_auth_authorization

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
