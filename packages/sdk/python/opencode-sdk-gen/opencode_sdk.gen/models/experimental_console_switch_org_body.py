from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ExperimentalConsoleSwitchOrgBody")


@_attrs_define
class ExperimentalConsoleSwitchOrgBody:
    """
    Attributes:
        account_id (str):
        org_id (str):
    """

    account_id: str
    org_id: str

    def to_dict(self) -> dict[str, Any]:
        account_id = self.account_id

        org_id = self.org_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "accountID": account_id,
                "orgID": org_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        account_id = d.pop("accountID")

        org_id = d.pop("orgID")

        experimental_console_switch_org_body = cls(
            account_id=account_id,
            org_id=org_id,
        )

        return experimental_console_switch_org_body
