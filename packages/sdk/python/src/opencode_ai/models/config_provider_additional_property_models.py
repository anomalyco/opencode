from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.config_provider_additional_property_models_additional_property import (
        ConfigProviderAdditionalPropertyModelsAdditionalProperty,
    )


T = TypeVar("T", bound="ConfigProviderAdditionalPropertyModels")


@_attrs_define
class ConfigProviderAdditionalPropertyModels:
    """ """

    additional_properties: dict[str, "ConfigProviderAdditionalPropertyModelsAdditionalProperty"] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:
        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_provider_additional_property_models_additional_property import (
            ConfigProviderAdditionalPropertyModelsAdditionalProperty,
        )

        d = dict(src_dict)
        config_provider_additional_property_models = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():
            additional_property = ConfigProviderAdditionalPropertyModelsAdditionalProperty.from_dict(prop_dict)

            additional_properties[prop_name] = additional_property

        config_provider_additional_property_models.additional_properties = additional_properties
        return config_provider_additional_property_models

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> "ConfigProviderAdditionalPropertyModelsAdditionalProperty":
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: "ConfigProviderAdditionalPropertyModelsAdditionalProperty") -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
