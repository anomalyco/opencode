from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_v2_info_options_aisdk import ModelV2InfoOptionsAisdk
    from ..models.model_v2_info_options_body import ModelV2InfoOptionsBody
    from ..models.model_v2_info_options_headers import ModelV2InfoOptionsHeaders


T = TypeVar("T", bound="ModelV2InfoOptions")


@_attrs_define
class ModelV2InfoOptions:
    """
    Attributes:
        headers (ModelV2InfoOptionsHeaders):
        body (ModelV2InfoOptionsBody):
        aisdk (ModelV2InfoOptionsAisdk):
        variant (str | Unset):
    """

    headers: ModelV2InfoOptionsHeaders
    body: ModelV2InfoOptionsBody
    aisdk: ModelV2InfoOptionsAisdk
    variant: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        headers = self.headers.to_dict()

        body = self.body.to_dict()

        aisdk = self.aisdk.to_dict()

        variant = self.variant

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "headers": headers,
                "body": body,
                "aisdk": aisdk,
            }
        )
        if variant is not UNSET:
            field_dict["variant"] = variant

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_v2_info_options_aisdk import ModelV2InfoOptionsAisdk
        from ..models.model_v2_info_options_body import ModelV2InfoOptionsBody
        from ..models.model_v2_info_options_headers import ModelV2InfoOptionsHeaders

        d = dict(src_dict)
        headers = ModelV2InfoOptionsHeaders.from_dict(d.pop("headers"))

        body = ModelV2InfoOptionsBody.from_dict(d.pop("body"))

        aisdk = ModelV2InfoOptionsAisdk.from_dict(d.pop("aisdk"))

        variant = d.pop("variant", UNSET)

        model_v2_info_options = cls(
            headers=headers,
            body=body,
            aisdk=aisdk,
            variant=variant,
        )

        return model_v2_info_options
