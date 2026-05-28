from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_v2_info_1_options_aisdk import ModelV2Info1OptionsAisdk
    from ..models.model_v2_info_1_options_body import ModelV2Info1OptionsBody
    from ..models.model_v2_info_1_options_headers import ModelV2Info1OptionsHeaders


T = TypeVar("T", bound="ModelV2Info1Options")


@_attrs_define
class ModelV2Info1Options:
    """
    Attributes:
        headers (ModelV2Info1OptionsHeaders):
        body (ModelV2Info1OptionsBody):
        aisdk (ModelV2Info1OptionsAisdk):
        variant (str | Unset):
    """

    headers: ModelV2Info1OptionsHeaders
    body: ModelV2Info1OptionsBody
    aisdk: ModelV2Info1OptionsAisdk
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
        from ..models.model_v2_info_1_options_aisdk import ModelV2Info1OptionsAisdk
        from ..models.model_v2_info_1_options_body import ModelV2Info1OptionsBody
        from ..models.model_v2_info_1_options_headers import ModelV2Info1OptionsHeaders

        d = dict(src_dict)
        headers = ModelV2Info1OptionsHeaders.from_dict(d.pop("headers"))

        body = ModelV2Info1OptionsBody.from_dict(d.pop("body"))

        aisdk = ModelV2Info1OptionsAisdk.from_dict(d.pop("aisdk"))

        variant = d.pop("variant", UNSET)

        model_v2_info_1_options = cls(
            headers=headers,
            body=body,
            aisdk=aisdk,
            variant=variant,
        )

        return model_v2_info_1_options
