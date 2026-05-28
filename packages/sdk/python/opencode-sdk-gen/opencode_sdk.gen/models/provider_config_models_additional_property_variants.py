from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.provider_config_models_additional_property_variants_additional_property import (
        ProviderConfigModelsAdditionalPropertyVariantsAdditionalProperty,
    )


T = TypeVar("T", bound="ProviderConfigModelsAdditionalPropertyVariants")


@_attrs_define
class ProviderConfigModelsAdditionalPropertyVariants:
    """Variant-specific configuration"""

    additional_properties: dict[str, ProviderConfigModelsAdditionalPropertyVariantsAdditionalProperty] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_config_models_additional_property_variants_additional_property import (
            ProviderConfigModelsAdditionalPropertyVariantsAdditionalProperty,
        )

        d = dict(src_dict)
        provider_config_models_additional_property_variants = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():
            additional_property = ProviderConfigModelsAdditionalPropertyVariantsAdditionalProperty.from_dict(prop_dict)

            additional_properties[prop_name] = additional_property

        provider_config_models_additional_property_variants.additional_properties = additional_properties
        return provider_config_models_additional_property_variants

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> ProviderConfigModelsAdditionalPropertyVariantsAdditionalProperty:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: ProviderConfigModelsAdditionalPropertyVariantsAdditionalProperty) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
