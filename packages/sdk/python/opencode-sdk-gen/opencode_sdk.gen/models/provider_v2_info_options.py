from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.provider_v2_info_options_aisdk import ProviderV2InfoOptionsAisdk
    from ..models.provider_v2_info_options_body import ProviderV2InfoOptionsBody
    from ..models.provider_v2_info_options_headers import ProviderV2InfoOptionsHeaders


T = TypeVar("T", bound="ProviderV2InfoOptions")


@_attrs_define
class ProviderV2InfoOptions:
    """
    Attributes:
        headers (ProviderV2InfoOptionsHeaders):
        body (ProviderV2InfoOptionsBody):
        aisdk (ProviderV2InfoOptionsAisdk):
    """

    headers: ProviderV2InfoOptionsHeaders
    body: ProviderV2InfoOptionsBody
    aisdk: ProviderV2InfoOptionsAisdk

    def to_dict(self) -> dict[str, Any]:
        headers = self.headers.to_dict()

        body = self.body.to_dict()

        aisdk = self.aisdk.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "headers": headers,
                "body": body,
                "aisdk": aisdk,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_v2_info_options_aisdk import ProviderV2InfoOptionsAisdk
        from ..models.provider_v2_info_options_body import ProviderV2InfoOptionsBody
        from ..models.provider_v2_info_options_headers import ProviderV2InfoOptionsHeaders

        d = dict(src_dict)
        headers = ProviderV2InfoOptionsHeaders.from_dict(d.pop("headers"))

        body = ProviderV2InfoOptionsBody.from_dict(d.pop("body"))

        aisdk = ProviderV2InfoOptionsAisdk.from_dict(d.pop("aisdk"))

        provider_v2_info_options = cls(
            headers=headers,
            body=body,
            aisdk=aisdk,
        )

        return provider_v2_info_options
