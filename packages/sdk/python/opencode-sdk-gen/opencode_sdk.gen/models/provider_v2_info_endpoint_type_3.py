from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_v2_info_endpoint_type_3_type import ProviderV2InfoEndpointType3Type

T = TypeVar("T", bound="ProviderV2InfoEndpointType3")


@_attrs_define
class ProviderV2InfoEndpointType3:
    """
    Attributes:
        type_ (ProviderV2InfoEndpointType3Type):
        url (str):
    """

    type_: ProviderV2InfoEndpointType3Type
    url: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        url = self.url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "url": url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = ProviderV2InfoEndpointType3Type(d.pop("type"))

        url = d.pop("url")

        provider_v2_info_endpoint_type_3 = cls(
            type_=type_,
            url=url,
        )

        return provider_v2_info_endpoint_type_3
