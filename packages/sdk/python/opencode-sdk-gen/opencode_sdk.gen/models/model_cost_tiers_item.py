from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.model_cost_tiers_item_cache import ModelCostTiersItemCache
    from ..models.model_cost_tiers_item_tier import ModelCostTiersItemTier


T = TypeVar("T", bound="ModelCostTiersItem")


@_attrs_define
class ModelCostTiersItem:
    """
    Attributes:
        input_ (float):
        output (float):
        cache (ModelCostTiersItemCache):
        tier (ModelCostTiersItemTier):
    """

    input_: float
    output: float
    cache: ModelCostTiersItemCache
    tier: ModelCostTiersItemTier

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        output = self.output

        cache = self.cache.to_dict()

        tier = self.tier.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "input": input_,
                "output": output,
                "cache": cache,
                "tier": tier,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_cost_tiers_item_cache import ModelCostTiersItemCache
        from ..models.model_cost_tiers_item_tier import ModelCostTiersItemTier

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache = ModelCostTiersItemCache.from_dict(d.pop("cache"))

        tier = ModelCostTiersItemTier.from_dict(d.pop("tier"))

        model_cost_tiers_item = cls(
            input_=input_,
            output=output,
            cache=cache,
            tier=tier,
        )

        return model_cost_tiers_item
