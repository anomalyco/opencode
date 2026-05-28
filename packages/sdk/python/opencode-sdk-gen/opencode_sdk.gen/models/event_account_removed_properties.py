from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.account_v2_info import AccountV2Info


T = TypeVar("T", bound="EventAccountRemovedProperties")


@_attrs_define
class EventAccountRemovedProperties:
    """
    Attributes:
        account (AccountV2Info):
    """

    account: AccountV2Info

    def to_dict(self) -> dict[str, Any]:
        account = self.account.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "account": account,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.account_v2_info import AccountV2Info

        d = dict(src_dict)
        account = AccountV2Info.from_dict(d.pop("account"))

        event_account_removed_properties = cls(
            account=account,
        )

        return event_account_removed_properties
