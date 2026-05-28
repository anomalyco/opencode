from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.provider_v2_info_options_aisdk_provider import ProviderV2InfoOptionsAisdkProvider
    from ..models.provider_v2_info_options_aisdk_request import ProviderV2InfoOptionsAisdkRequest


T = TypeVar("T", bound="ProviderV2InfoOptionsAisdk")


@_attrs_define
class ProviderV2InfoOptionsAisdk:
    """
    Attributes:
        provider (ProviderV2InfoOptionsAisdkProvider):
        request (ProviderV2InfoOptionsAisdkRequest):
    """

    provider: ProviderV2InfoOptionsAisdkProvider
    request: ProviderV2InfoOptionsAisdkRequest

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
        from ..models.provider_v2_info_options_aisdk_provider import ProviderV2InfoOptionsAisdkProvider
        from ..models.provider_v2_info_options_aisdk_request import ProviderV2InfoOptionsAisdkRequest

        d = dict(src_dict)
        provider = ProviderV2InfoOptionsAisdkProvider.from_dict(d.pop("provider"))

        request = ProviderV2InfoOptionsAisdkRequest.from_dict(d.pop("request"))

        provider_v2_info_options_aisdk = cls(
            provider=provider,
            request=request,
        )

        return provider_v2_info_options_aisdk
