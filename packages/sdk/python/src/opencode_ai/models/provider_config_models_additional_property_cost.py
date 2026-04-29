from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_config_models_additional_property_cost_context_over_200k import (
        ProviderConfigModelsAdditionalPropertyCostContextOver200K,
    )


T = TypeVar("T", bound="ProviderConfigModelsAdditionalPropertyCost")


@_attrs_define
class ProviderConfigModelsAdditionalPropertyCost:
    """
    Attributes:
        input_ (float):
        output (float):
        cache_read (float | Unset):
        cache_write (float | Unset):
        context_over_200k (ProviderConfigModelsAdditionalPropertyCostContextOver200K | Unset):
    """

    input_: float
    output: float
    cache_read: float | Unset = UNSET
    cache_write: float | Unset = UNSET
    context_over_200k: ProviderConfigModelsAdditionalPropertyCostContextOver200K | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_config_models_additional_property_cost_context_over_200k import (
            ProviderConfigModelsAdditionalPropertyCostContextOver200K,
        )

        input_ = self.input_

        output = self.output

        cache_read = self.cache_read

        cache_write = self.cache_write

        context_over_200k: dict[str, Any] | Unset = UNSET
        if not isinstance(self.context_over_200k, Unset):
            context_over_200k = self.context_over_200k.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "input": input_,
                "output": output,
            }
        )
        if cache_read is not UNSET:
            field_dict["cache_read"] = cache_read
        if cache_write is not UNSET:
            field_dict["cache_write"] = cache_write
        if context_over_200k is not UNSET:
            field_dict["context_over_200k"] = context_over_200k

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_config_models_additional_property_cost_context_over_200k import (
            ProviderConfigModelsAdditionalPropertyCostContextOver200K,
        )

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache_read = d.pop("cache_read", UNSET)

        cache_write = d.pop("cache_write", UNSET)

        _context_over_200k = d.pop("context_over_200k", UNSET)
        context_over_200k: ProviderConfigModelsAdditionalPropertyCostContextOver200K | Unset
        if isinstance(_context_over_200k, Unset):
            context_over_200k = UNSET
        else:
            context_over_200k = ProviderConfigModelsAdditionalPropertyCostContextOver200K.from_dict(_context_over_200k)

        provider_config_models_additional_property_cost = cls(
            input_=input_,
            output=output,
            cache_read=cache_read,
            cache_write=cache_write,
            context_over_200k=context_over_200k,
        )

        provider_config_models_additional_property_cost.additional_properties = d
        return provider_config_models_additional_property_cost

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
