from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="ConfigProviderAdditionalPropertyModelsAdditionalPropertyLimit")


@_attrs_define
class ConfigProviderAdditionalPropertyModelsAdditionalPropertyLimit:
    """
    Attributes:
        context (float):
        output (float):
    """

    context: float
    output: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        context = self.context

        output = self.output

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "context": context,
                "output": output,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        context = d.pop("context")

        output = d.pop("output")

        config_provider_additional_property_models_additional_property_limit = cls(
            context=context,
            output=output,
        )

        config_provider_additional_property_models_additional_property_limit.additional_properties = d
        return config_provider_additional_property_models_additional_property_limit

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
