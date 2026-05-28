from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderConfigModelsAdditionalPropertyCostContextOver200K")


@_attrs_define
class ProviderConfigModelsAdditionalPropertyCostContextOver200K:
    """
    Attributes:
        input_ (float):
        output (float):
        cache_read (float | Unset):
        cache_write (float | Unset):
    """

    input_: float
    output: float
    cache_read: float | Unset = UNSET
    cache_write: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        output = self.output

        cache_read = self.cache_read

        cache_write = self.cache_write

        field_dict: dict[str, Any] = {}

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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache_read = d.pop("cache_read", UNSET)

        cache_write = d.pop("cache_write", UNSET)

        provider_config_models_additional_property_cost_context_over_200k = cls(
            input_=input_,
            output=output,
            cache_read=cache_read,
            cache_write=cache_write,
        )

        return provider_config_models_additional_property_cost_context_over_200k
