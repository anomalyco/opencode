from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderConfigModelsAdditionalPropertyProvider")


@_attrs_define
class ProviderConfigModelsAdditionalPropertyProvider:
    """
    Attributes:
        npm (str | Unset):
        api (str | Unset):
    """

    npm: str | Unset = UNSET
    api: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        npm = self.npm

        api = self.api

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if npm is not UNSET:
            field_dict["npm"] = npm
        if api is not UNSET:
            field_dict["api"] = api

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        npm = d.pop("npm", UNSET)

        api = d.pop("api", UNSET)

        provider_config_models_additional_property_provider = cls(
            npm=npm,
            api=api,
        )

        provider_config_models_additional_property_provider.additional_properties = d
        return provider_config_models_additional_property_provider

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
