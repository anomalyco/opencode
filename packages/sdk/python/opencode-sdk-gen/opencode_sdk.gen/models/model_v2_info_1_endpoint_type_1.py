from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_v2_info_1_endpoint_type_1_type import ModelV2Info1EndpointType1Type
from ..types import UNSET, Unset

T = TypeVar("T", bound="ModelV2Info1EndpointType1")


@_attrs_define
class ModelV2Info1EndpointType1:
    """
    Attributes:
        type_ (ModelV2Info1EndpointType1Type):
        url (str):
        websocket (bool | Unset):
    """

    type_: ModelV2Info1EndpointType1Type
    url: str
    websocket: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        url = self.url

        websocket = self.websocket

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "url": url,
            }
        )
        if websocket is not UNSET:
            field_dict["websocket"] = websocket

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = ModelV2Info1EndpointType1Type(d.pop("type"))

        url = d.pop("url")

        websocket = d.pop("websocket", UNSET)

        model_v2_info_1_endpoint_type_1 = cls(
            type_=type_,
            url=url,
            websocket=websocket,
        )

        return model_v2_info_1_endpoint_type_1
