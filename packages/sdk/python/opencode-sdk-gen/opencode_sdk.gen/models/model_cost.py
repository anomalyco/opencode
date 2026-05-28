from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_cost_cache import ModelCostCache
    from ..models.model_cost_experimental_over_200k import ModelCostExperimentalOver200K
    from ..models.model_cost_tiers_item import ModelCostTiersItem


T = TypeVar("T", bound="ModelCost")


@_attrs_define
class ModelCost:
    """
    Attributes:
        input_ (float):
        output (float):
        cache (ModelCostCache):
        tiers (list[ModelCostTiersItem] | Unset):
        experimental_over_200k (ModelCostExperimentalOver200K | Unset):
    """

    input_: float
    output: float
    cache: ModelCostCache
    tiers: list[ModelCostTiersItem] | Unset = UNSET
    experimental_over_200k: ModelCostExperimentalOver200K | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        output = self.output

        cache = self.cache.to_dict()

        tiers: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.tiers, Unset):
            tiers = []
            for tiers_item_data in self.tiers:
                tiers_item = tiers_item_data.to_dict()
                tiers.append(tiers_item)

        experimental_over_200k: dict[str, Any] | Unset = UNSET
        if not isinstance(self.experimental_over_200k, Unset):
            experimental_over_200k = self.experimental_over_200k.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "input": input_,
                "output": output,
                "cache": cache,
            }
        )
        if tiers is not UNSET:
            field_dict["tiers"] = tiers
        if experimental_over_200k is not UNSET:
            field_dict["experimentalOver200K"] = experimental_over_200k

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_cost_cache import ModelCostCache
        from ..models.model_cost_experimental_over_200k import ModelCostExperimentalOver200K
        from ..models.model_cost_tiers_item import ModelCostTiersItem

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache = ModelCostCache.from_dict(d.pop("cache"))

        _tiers = d.pop("tiers", UNSET)
        tiers: list[ModelCostTiersItem] | Unset = UNSET
        if _tiers is not UNSET:
            tiers = []
            for tiers_item_data in _tiers:
                tiers_item = ModelCostTiersItem.from_dict(tiers_item_data)

                tiers.append(tiers_item)

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
            tiers=tiers,
            experimental_over_200k=experimental_over_200k,
        )

        return model_cost
