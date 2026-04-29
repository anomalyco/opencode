from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.provider_config_models_additional_property_modalities_input_item import (
    ProviderConfigModelsAdditionalPropertyModalitiesInputItem,
)
from ..models.provider_config_models_additional_property_modalities_output_item import (
    ProviderConfigModelsAdditionalPropertyModalitiesOutputItem,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderConfigModelsAdditionalPropertyModalities")


@_attrs_define
class ProviderConfigModelsAdditionalPropertyModalities:
    """
    Attributes:
        input_ (list[ProviderConfigModelsAdditionalPropertyModalitiesInputItem]):
        output (list[ProviderConfigModelsAdditionalPropertyModalitiesOutputItem]):
    """

    input_: list[ProviderConfigModelsAdditionalPropertyModalitiesInputItem]
    output: list[ProviderConfigModelsAdditionalPropertyModalitiesOutputItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        input_ = []
        for input_item_data in self.input_:
            input_item = input_item_data.value
            input_.append(input_item)

        output = []
        for output_item_data in self.output:
            output_item = output_item_data.value
            output.append(output_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "input": input_,
                "output": output,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        input_ = []
        _input_ = d.pop("input")
        for input_item_data in _input_:
            input_item = ProviderConfigModelsAdditionalPropertyModalitiesInputItem(input_item_data)

            input_.append(input_item)

        output = []
        _output = d.pop("output")
        for output_item_data in _output:
            output_item = ProviderConfigModelsAdditionalPropertyModalitiesOutputItem(output_item_data)

            output.append(output_item)

        provider_config_models_additional_property_modalities = cls(
            input_=input_,
            output=output,
        )

        provider_config_models_additional_property_modalities.additional_properties = d
        return provider_config_models_additional_property_modalities

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
