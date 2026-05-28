from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_v2_info_1_cost_item_tier_type import ModelV2Info1CostItemTierType

T = TypeVar("T", bound="ModelV2Info1CostItemTier")


@_attrs_define
class ModelV2Info1CostItemTier:
    """
    Attributes:
        type_ (ModelV2Info1CostItemTierType):
        size (int):
    """

    type_: ModelV2Info1CostItemTierType
    size: int

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        size = self.size

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "size": size,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = ModelV2Info1CostItemTierType(d.pop("type"))

        size = d.pop("size")

        model_v2_info_1_cost_item_tier = cls(
            type_=type_,
            size=size,
        )

        return model_v2_info_1_cost_item_tier
