from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="OAuth")


@_attrs_define
class OAuth:
    """
    Attributes:
        type_ (Literal['oauth']):
        refresh (str):
        access (str):
        expires (int):
        account_id (str | Unset):
        enterprise_url (str | Unset):
    """

    type_: Literal["oauth"]
    refresh: str
    access: str
    expires: int
    account_id: str | Unset = UNSET
    enterprise_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        refresh = self.refresh

        access = self.access

        expires = self.expires

        account_id = self.account_id

        enterprise_url = self.enterprise_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        type_ = cast(Literal["oauth"], d.pop("type"))
        if type_ != "oauth":
            raise ValueError(f"type must match const 'oauth', got '{type_}'")

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

        o_auth.additional_properties = d
        return o_auth

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
