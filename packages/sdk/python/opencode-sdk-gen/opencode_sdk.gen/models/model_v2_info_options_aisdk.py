from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.model_v2_info_options_aisdk_provider import ModelV2InfoOptionsAisdkProvider
    from ..models.model_v2_info_options_aisdk_request import ModelV2InfoOptionsAisdkRequest


T = TypeVar("T", bound="ModelV2InfoOptionsAisdk")


@_attrs_define
class ModelV2InfoOptionsAisdk:
    """
    Attributes:
        provider (ModelV2InfoOptionsAisdkProvider):
        request (ModelV2InfoOptionsAisdkRequest):
    """

    provider: ModelV2InfoOptionsAisdkProvider
    request: ModelV2InfoOptionsAisdkRequest

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
        from ..models.model_v2_info_options_aisdk_provider import ModelV2InfoOptionsAisdkProvider
        from ..models.model_v2_info_options_aisdk_request import ModelV2InfoOptionsAisdkRequest

        d = dict(src_dict)
        provider = ModelV2InfoOptionsAisdkProvider.from_dict(d.pop("provider"))

        request = ModelV2InfoOptionsAisdkRequest.from_dict(d.pop("request"))

        model_v2_info_options_aisdk = cls(
            provider=provider,
            request=request,
        )

        return model_v2_info_options_aisdk
