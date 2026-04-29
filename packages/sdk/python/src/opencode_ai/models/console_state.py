from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        console_managed_providers = self.console_managed_providers

        switchable_org_count = self.switchable_org_count

        active_org_name = self.active_org_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        console_state.additional_properties = d
        return console_state

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
