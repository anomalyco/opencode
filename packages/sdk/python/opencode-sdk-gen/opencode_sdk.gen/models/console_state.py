from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConsoleState")


@_attrs_define
class ConsoleState:
    """
    Attributes:
        console_managed_providers (list[str]):
        switchable_org_count (int):
        active_org_name (str | Unset):
    """

    console_managed_providers: list[str]
    switchable_org_count: int
    active_org_name: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        console_managed_providers = self.console_managed_providers

        switchable_org_count = self.switchable_org_count

        active_org_name = self.active_org_name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "consoleManagedProviders": console_managed_providers,
                "switchableOrgCount": switchable_org_count,
            }
        )
        if active_org_name is not UNSET:
            field_dict["activeOrgName"] = active_org_name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        console_managed_providers = cast(list[str], d.pop("consoleManagedProviders"))

        switchable_org_count = d.pop("switchableOrgCount")

        active_org_name = d.pop("activeOrgName", UNSET)

        console_state = cls(
            console_managed_providers=console_managed_providers,
            switchable_org_count=switchable_org_count,
            active_org_name=active_org_name,
        )

        return console_state
