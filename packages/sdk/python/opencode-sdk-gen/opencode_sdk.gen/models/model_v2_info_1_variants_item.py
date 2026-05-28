from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.model_v2_info_1_variants_item_aisdk import ModelV2Info1VariantsItemAisdk
    from ..models.model_v2_info_1_variants_item_body import ModelV2Info1VariantsItemBody
    from ..models.model_v2_info_1_variants_item_headers import ModelV2Info1VariantsItemHeaders


T = TypeVar("T", bound="ModelV2Info1VariantsItem")


@_attrs_define
class ModelV2Info1VariantsItem:
    """
    Attributes:
        id (str):
        headers (ModelV2Info1VariantsItemHeaders):
        body (ModelV2Info1VariantsItemBody):
        aisdk (ModelV2Info1VariantsItemAisdk):
    """

    id: str
    headers: ModelV2Info1VariantsItemHeaders
    body: ModelV2Info1VariantsItemBody
    aisdk: ModelV2Info1VariantsItemAisdk

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        headers = self.headers.to_dict()

        body = self.body.to_dict()

        aisdk = self.aisdk.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "headers": headers,
                "body": body,
                "aisdk": aisdk,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_v2_info_1_variants_item_aisdk import ModelV2Info1VariantsItemAisdk
        from ..models.model_v2_info_1_variants_item_body import ModelV2Info1VariantsItemBody
        from ..models.model_v2_info_1_variants_item_headers import ModelV2Info1VariantsItemHeaders

        d = dict(src_dict)
        id = d.pop("id")

        headers = ModelV2Info1VariantsItemHeaders.from_dict(d.pop("headers"))

        body = ModelV2Info1VariantsItemBody.from_dict(d.pop("body"))

        aisdk = ModelV2Info1VariantsItemAisdk.from_dict(d.pop("aisdk"))

        model_v2_info_1_variants_item = cls(
            id=id,
            headers=headers,
            body=body,
            aisdk=aisdk,
        )

        return model_v2_info_1_variants_item
