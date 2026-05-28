from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.model_v2_info_variants_item_aisdk import ModelV2InfoVariantsItemAisdk
    from ..models.model_v2_info_variants_item_body import ModelV2InfoVariantsItemBody
    from ..models.model_v2_info_variants_item_headers import ModelV2InfoVariantsItemHeaders


T = TypeVar("T", bound="ModelV2InfoVariantsItem")


@_attrs_define
class ModelV2InfoVariantsItem:
    """
    Attributes:
        id (str):
        headers (ModelV2InfoVariantsItemHeaders):
        body (ModelV2InfoVariantsItemBody):
        aisdk (ModelV2InfoVariantsItemAisdk):
    """

    id: str
    headers: ModelV2InfoVariantsItemHeaders
    body: ModelV2InfoVariantsItemBody
    aisdk: ModelV2InfoVariantsItemAisdk

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
        from ..models.model_v2_info_variants_item_aisdk import ModelV2InfoVariantsItemAisdk
        from ..models.model_v2_info_variants_item_body import ModelV2InfoVariantsItemBody
        from ..models.model_v2_info_variants_item_headers import ModelV2InfoVariantsItemHeaders

        d = dict(src_dict)
        id = d.pop("id")

        headers = ModelV2InfoVariantsItemHeaders.from_dict(d.pop("headers"))

        body = ModelV2InfoVariantsItemBody.from_dict(d.pop("body"))

        aisdk = ModelV2InfoVariantsItemAisdk.from_dict(d.pop("aisdk"))

        model_v2_info_variants_item = cls(
            id=id,
            headers=headers,
            body=body,
            aisdk=aisdk,
        )

        return model_v2_info_variants_item
