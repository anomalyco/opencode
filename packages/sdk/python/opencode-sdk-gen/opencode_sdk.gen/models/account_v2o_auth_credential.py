from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.account_v2o_auth_credential_type import AccountV2OAuthCredentialType

T = TypeVar("T", bound="AccountV2OAuthCredential")


@_attrs_define
class AccountV2OAuthCredential:
    """
    Attributes:
        type_ (AccountV2OAuthCredentialType):
        refresh (str):
        access (str):
        expires (int):
    """

    type_: AccountV2OAuthCredentialType
    refresh: str
    access: str
    expires: int

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        refresh = self.refresh

        access = self.access

        expires = self.expires

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "refresh": refresh,
                "access": access,
                "expires": expires,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = AccountV2OAuthCredentialType(d.pop("type"))

        refresh = d.pop("refresh")

        access = d.pop("access")

        expires = d.pop("expires")

        account_v2o_auth_credential = cls(
            type_=type_,
            refresh=refresh,
            access=access,
            expires=expires,
        )

        return account_v2o_auth_credential
