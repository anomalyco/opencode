from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_v2_info_cost_item_cache import ModelV2InfoCostItemCache
    from ..models.model_v2_info_cost_item_tier import ModelV2InfoCostItemTier


T = TypeVar("T", bound="ModelV2InfoCostItem")


@_attrs_define
class ModelV2InfoCostItem:
    """
    Attributes:
        input_ (float):
        output (float):
        cache (ModelV2InfoCostItemCache):
        tier (ModelV2InfoCostItemTier | Unset):
    """

    input_: float
    output: float
    cache: ModelV2InfoCostItemCache
    tier: ModelV2InfoCostItemTier | Unset = UNSET

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
        from ..models.model_v2_info_cost_item_cache import ModelV2InfoCostItemCache
        from ..models.model_v2_info_cost_item_tier import ModelV2InfoCostItemTier

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache = ModelV2InfoCostItemCache.from_dict(d.pop("cache"))

        _tier = d.pop("tier", UNSET)
        tier: ModelV2InfoCostItemTier | Unset
        if isinstance(_tier, Unset):
            tier = UNSET
        else:
            tier = ModelV2InfoCostItemTier.from_dict(_tier)

        model_v2_info_cost_item = cls(
            input_=input_,
            output=output,
            cache=cache,
            tier=tier,
        )

        return model_v2_info_cost_item
