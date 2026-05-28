from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        output = self.output

        cache = self.cache.to_dict()

        field_dict: dict[str, Any] = {}

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

        return model_cost_experimental_over_200k
