from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ExperimentalConsoleListOrgsResponse200OrgsItem")


@_attrs_define
class ExperimentalConsoleListOrgsResponse200OrgsItem:
    """
    Attributes:
        account_id (str):
        account_email (str):
        account_url (str):
        org_id (str):
        org_name (str):
        active (bool):
    """

    account_id: str
    account_email: str
    account_url: str
    org_id: str
    org_name: str
    active: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        account_id = self.account_id

        account_email = self.account_email

        account_url = self.account_url

        org_id = self.org_id

        org_name = self.org_name

        active = self.active

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "accountID": account_id,
                "accountEmail": account_email,
                "accountUrl": account_url,
                "orgID": org_id,
                "orgName": org_name,
                "active": active,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        account_id = d.pop("accountID")

        account_email = d.pop("accountEmail")

        account_url = d.pop("accountUrl")

        org_id = d.pop("orgID")

        org_name = d.pop("orgName")

        active = d.pop("active")

        experimental_console_list_orgs_response_200_orgs_item = cls(
            account_id=account_id,
            account_email=account_email,
            account_url=account_url,
            org_id=org_id,
            org_name=org_name,
            active=active,
        )

        experimental_console_list_orgs_response_200_orgs_item.additional_properties = d
        return experimental_console_list_orgs_response_200_orgs_item

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
