from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_cost_cache import ModelCostCache
    from ..models.model_cost_experimental_over_200k import ModelCostExperimentalOver200K


T = TypeVar("T", bound="ModelCost")


@_attrs_define
class ModelCost:
    """
    Attributes:
        input_ (float):
        output (float):
        cache (ModelCostCache):
        experimental_over_200k (ModelCostExperimentalOver200K | Unset):
    """

    input_: float
    output: float
    cache: ModelCostCache
    experimental_over_200k: ModelCostExperimentalOver200K | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.model_cost_cache import ModelCostCache
        from ..models.model_cost_experimental_over_200k import ModelCostExperimentalOver200K

        input_ = self.input_

        output = self.output

        cache = self.cache.to_dict()

        experimental_over_200k: dict[str, Any] | Unset = UNSET
        if not isinstance(self.experimental_over_200k, Unset):
            experimental_over_200k = self.experimental_over_200k.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "input": input_,
                "output": output,
                "cache": cache,
            }
        )
        if experimental_over_200k is not UNSET:
            field_dict["experimentalOver200K"] = experimental_over_200k

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_cost_cache import ModelCostCache
        from ..models.model_cost_experimental_over_200k import ModelCostExperimentalOver200K

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache = ModelCostCache.from_dict(d.pop("cache"))

        _experimental_over_200k = d.pop("experimentalOver200K", UNSET)
        experimental_over_200k: ModelCostExperimentalOver200K | Unset
        if isinstance(_experimental_over_200k, Unset):
            experimental_over_200k = UNSET
        else:
            experimental_over_200k = ModelCostExperimentalOver200K.from_dict(_experimental_over_200k)

        model_cost = cls(
            input_=input_,
            output=output,
            cache=cache,
            experimental_over_200k=experimental_over_200k,
        )

        model_cost.additional_properties = d
        return model_cost

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
