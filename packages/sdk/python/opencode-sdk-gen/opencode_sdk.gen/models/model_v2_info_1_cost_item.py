from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_v2_info_1_cost_item_cache import ModelV2Info1CostItemCache
    from ..models.model_v2_info_1_cost_item_tier import ModelV2Info1CostItemTier


T = TypeVar("T", bound="ModelV2Info1CostItem")


@_attrs_define
class ModelV2Info1CostItem:
    """
    Attributes:
        input_ (float):
        output (float):
        cache (ModelV2Info1CostItemCache):
        tier (ModelV2Info1CostItemTier | Unset):
    """

    input_: float
    output: float
    cache: ModelV2Info1CostItemCache
    tier: ModelV2Info1CostItemTier | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        output = self.output

        cache = self.cache.to_dict()

        tier: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tier, Unset):
            tier = self.tier.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "input": input_,
                "output": output,
                "cache": cache,
            }
        )
        if tier is not UNSET:
            field_dict["tier"] = tier

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_v2_info_1_cost_item_cache import ModelV2Info1CostItemCache
        from ..models.model_v2_info_1_cost_item_tier import ModelV2Info1CostItemTier

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache = ModelV2Info1CostItemCache.from_dict(d.pop("cache"))

        _tier = d.pop("tier", UNSET)
        tier: ModelV2Info1CostItemTier | Unset
        if isinstance(_tier, Unset):
            tier = UNSET
        else:
            tier = ModelV2Info1CostItemTier.from_dict(_tier)

        model_v2_info_1_cost_item = cls(
            input_=input_,
            output=output,
            cache=cache,
            tier=tier,
        )

        return model_v2_info_1_cost_item
