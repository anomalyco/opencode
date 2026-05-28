from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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
        input_ (list[ProviderConfigModelsAdditionalPropertyModalitiesInputItem] | Unset):
        output (list[ProviderConfigModelsAdditionalPropertyModalitiesOutputItem] | Unset):
    """

    input_: list[ProviderConfigModelsAdditionalPropertyModalitiesInputItem] | Unset = UNSET
    output: list[ProviderConfigModelsAdditionalPropertyModalitiesOutputItem] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        input_: list[str] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = []
            for input_item_data in self.input_:
                input_item = input_item_data.value
                input_.append(input_item)

        output: list[str] | Unset = UNSET
        if not isinstance(self.output, Unset):
            output = []
            for output_item_data in self.output:
                output_item = output_item_data.value
                output.append(output_item)

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if input_ is not UNSET:
            field_dict["input"] = input_
        if output is not UNSET:
            field_dict["output"] = output

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _input_ = d.pop("input", UNSET)
        input_: list[ProviderConfigModelsAdditionalPropertyModalitiesInputItem] | Unset = UNSET
        if _input_ is not UNSET:
            input_ = []
            for input_item_data in _input_:
                input_item = ProviderConfigModelsAdditionalPropertyModalitiesInputItem(input_item_data)

                input_.append(input_item)

        _output = d.pop("output", UNSET)
        output: list[ProviderConfigModelsAdditionalPropertyModalitiesOutputItem] | Unset = UNSET
        if _output is not UNSET:
            output = []
            for output_item_data in _output:
                output_item = ProviderConfigModelsAdditionalPropertyModalitiesOutputItem(output_item_data)

                output.append(output_item)

        provider_config_models_additional_property_modalities = cls(
            input_=input_,
            output=output,
        )

        return provider_config_models_additional_property_modalities
