from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.model_v2_info_1_variants_item_aisdk_provider import ModelV2Info1VariantsItemAisdkProvider
    from ..models.model_v2_info_1_variants_item_aisdk_request import ModelV2Info1VariantsItemAisdkRequest


T = TypeVar("T", bound="ModelV2Info1VariantsItemAisdk")


@_attrs_define
class ModelV2Info1VariantsItemAisdk:
    """
    Attributes:
        provider (ModelV2Info1VariantsItemAisdkProvider):
        request (ModelV2Info1VariantsItemAisdkRequest):
    """

    provider: ModelV2Info1VariantsItemAisdkProvider
    request: ModelV2Info1VariantsItemAisdkRequest

    def to_dict(self) -> dict[str, Any]:
        provider = self.provider.to_dict()

        request = self.request.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "provider": provider,
                "request": request,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_v2_info_1_variants_item_aisdk_provider import ModelV2Info1VariantsItemAisdkProvider
        from ..models.model_v2_info_1_variants_item_aisdk_request import ModelV2Info1VariantsItemAisdkRequest

        d = dict(src_dict)
        provider = ModelV2Info1VariantsItemAisdkProvider.from_dict(d.pop("provider"))

        request = ModelV2Info1VariantsItemAisdkRequest.from_dict(d.pop("request"))

        model_v2_info_1_variants_item_aisdk = cls(
            provider=provider,
            request=request,
        )

        return model_v2_info_1_variants_item_aisdk
