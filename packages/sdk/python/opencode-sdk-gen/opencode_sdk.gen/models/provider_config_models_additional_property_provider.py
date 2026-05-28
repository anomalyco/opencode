from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        npm = self.npm

        api = self.api

        field_dict: dict[str, Any] = {}

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

        return provider_config_models_additional_property_provider
