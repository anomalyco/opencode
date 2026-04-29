from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_cost_experimental_over_200k_cache import ModelCostExperimentalOver200KCache


T = TypeVar("T", bound="ModelCostExperimentalOver200K")


@_attrs_define
class ModelCostExperimentalOver200K:
    """
    Attributes:
        input_ (float):
        output (float):
        cache (ModelCostExperimentalOver200KCache):
    """

    input_: float
    output: float
    cache: ModelCostExperimentalOver200KCache
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.model_cost_experimental_over_200k_cache import ModelCostExperimentalOver200KCache

        input_ = self.input_

        output = self.output

        cache = self.cache.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "input": input_,
                "output": output,
                "cache": cache,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_cost_experimental_over_200k_cache import ModelCostExperimentalOver200KCache

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache = ModelCostExperimentalOver200KCache.from_dict(d.pop("cache"))

        model_cost_experimental_over_200k = cls(
            input_=input_,
            output=output,
            cache=cache,
        )

        model_cost_experimental_over_200k.additional_properties = d
        return model_cost_experimental_over_200k

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
