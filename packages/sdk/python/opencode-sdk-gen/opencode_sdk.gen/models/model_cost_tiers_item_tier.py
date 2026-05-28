from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_cost_tiers_item_tier_type import ModelCostTiersItemTierType

T = TypeVar("T", bound="ModelCostTiersItemTier")


@_attrs_define
class ModelCostTiersItemTier:
    """
    Attributes:
        type_ (ModelCostTiersItemTierType):
        size (float):
    """

    type_: ModelCostTiersItemTierType
    size: float

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
        type_ = ModelCostTiersItemTierType(d.pop("type"))

        size = d.pop("size")

        model_cost_tiers_item_tier = cls(
            type_=type_,
            size=size,
        )

        return model_cost_tiers_item_tier
