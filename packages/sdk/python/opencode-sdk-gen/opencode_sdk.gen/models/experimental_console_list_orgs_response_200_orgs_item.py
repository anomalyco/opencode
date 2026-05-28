from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        account_id = self.account_id

        account_email = self.account_email

        account_url = self.account_url

        org_id = self.org_id

        org_name = self.org_name

        active = self.active

        field_dict: dict[str, Any] = {}

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

        return experimental_console_list_orgs_response_200_orgs_item
