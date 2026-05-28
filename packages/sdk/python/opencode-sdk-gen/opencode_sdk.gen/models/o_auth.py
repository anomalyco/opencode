from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.o_auth_type import OAuthType
from ..types import UNSET, Unset

T = TypeVar("T", bound="OAuth")


@_attrs_define
class OAuth:
    """
    Attributes:
        type_ (OAuthType):
        refresh (str):
        access (str):
        expires (int):
        account_id (str | Unset):
        enterprise_url (str | Unset):
    """

    type_: OAuthType
    refresh: str
    access: str
    expires: int
    account_id: str | Unset = UNSET
    enterprise_url: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        refresh = self.refresh

        access = self.access

        expires = self.expires

        account_id = self.account_id

        enterprise_url = self.enterprise_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "refresh": refresh,
                "access": access,
                "expires": expires,
            }
        )
        if account_id is not UNSET:
            field_dict["accountId"] = account_id
        if enterprise_url is not UNSET:
            field_dict["enterpriseUrl"] = enterprise_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = OAuthType(d.pop("type"))

        refresh = d.pop("refresh")

        access = d.pop("access")

        expires = d.pop("expires")

        account_id = d.pop("accountId", UNSET)

        enterprise_url = d.pop("enterpriseUrl", UNSET)

        o_auth = cls(
            type_=type_,
            refresh=refresh,
            access=access,
            expires=expires,
            account_id=account_id,
            enterprise_url=enterprise_url,
        )

        return o_auth
