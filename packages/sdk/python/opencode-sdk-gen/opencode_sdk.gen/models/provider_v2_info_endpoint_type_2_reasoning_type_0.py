from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_v2_info_endpoint_type_2_reasoning_type_0_type import (
    ProviderV2InfoEndpointType2ReasoningType0Type,
)

T = TypeVar("T", bound="ProviderV2InfoEndpointType2ReasoningType0")


@_attrs_define
class ProviderV2InfoEndpointType2ReasoningType0:
    """
    Attributes:
        type_ (ProviderV2InfoEndpointType2ReasoningType0Type):
    """

    type_: ProviderV2InfoEndpointType2ReasoningType0Type

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = ProviderV2InfoEndpointType2ReasoningType0Type(d.pop("type"))

        provider_v2_info_endpoint_type_2_reasoning_type_0 = cls(
            type_=type_,
        )

        return provider_v2_info_endpoint_type_2_reasoning_type_0
