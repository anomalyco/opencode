from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.model_v2_info_variants_item_aisdk_provider import ModelV2InfoVariantsItemAisdkProvider
    from ..models.model_v2_info_variants_item_aisdk_request import ModelV2InfoVariantsItemAisdkRequest


T = TypeVar("T", bound="ModelV2InfoVariantsItemAisdk")


@_attrs_define
class ModelV2InfoVariantsItemAisdk:
    """
    Attributes:
        provider (ModelV2InfoVariantsItemAisdkProvider):
        request (ModelV2InfoVariantsItemAisdkRequest):
    """

    provider: ModelV2InfoVariantsItemAisdkProvider
    request: ModelV2InfoVariantsItemAisdkRequest

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
        from ..models.model_v2_info_variants_item_aisdk_provider import ModelV2InfoVariantsItemAisdkProvider
        from ..models.model_v2_info_variants_item_aisdk_request import ModelV2InfoVariantsItemAisdkRequest

        d = dict(src_dict)
        provider = ModelV2InfoVariantsItemAisdkProvider.from_dict(d.pop("provider"))

        request = ModelV2InfoVariantsItemAisdkRequest.from_dict(d.pop("request"))

        model_v2_info_variants_item_aisdk = cls(
            provider=provider,
            request=request,
        )

        return model_v2_info_variants_item_aisdk
